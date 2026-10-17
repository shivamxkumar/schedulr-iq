"""Minimal stateless auth: PBKDF2-hashed users + HMAC-signed bearer tokens.

Roles: `admin` may change anything; `viewer` is read-only. Accounts come from environment
variables (set these in production) with development defaults documented in .env.example.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Optional

SECRET_PATH = Path(__file__).resolve().parent.parent / "data" / ".secret"
TOKEN_TTL = 12 * 3600


def _secret() -> bytes:
    env = os.environ.get("SCHEDULR_SECRET")
    if env:
        return env.encode()
    SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not SECRET_PATH.exists():
        SECRET_PATH.write_text(secrets.token_hex(32))
    return SECRET_PATH.read_text().strip().encode()


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)


PRODUCTION = bool(os.environ.get("RENDER")) or os.environ.get("SCHEDULR_ENV") == "production"


def _users() -> dict[str, dict]:
    # In production an account is enabled only if its password is set explicitly: the
    # development defaults below are public in the repository.
    accounts = [
        (os.environ.get("ADMIN_USERNAME", "admin"), os.environ.get("ADMIN_PASSWORD", "admin@iiits"), "admin",
         "Timetable Administrator"),
        (os.environ.get("VIEWER_USERNAME", "viewer"), os.environ.get("VIEWER_PASSWORD", "viewer@iiits"), "viewer",
         "Read-only Viewer"),
    ]
    out = {}
    explicit = {"admin": "ADMIN_PASSWORD", "viewer": "VIEWER_PASSWORD"}
    for user, pw, role, name in accounts:
        if PRODUCTION and not os.environ.get(explicit[role]):
            print(f"[auth] {role} account disabled: set {explicit[role]} to enable it.")
            continue
        salt = hashlib.sha256(f"schedulr:{user}".encode()).digest()[:16]
        out[user] = {"username": user, "role": role, "name": name, "salt": salt, "hash": _hash(pw, salt)}
    return out


USERS = _users()


def authenticate(username: str, password: str) -> Optional[dict]:
    u = USERS.get(username.strip())
    if not u or not hmac.compare_digest(_hash(password, u["salt"]), u["hash"]):
        return None
    return {"username": u["username"], "role": u["role"], "name": u["name"]}


def issue(user: dict) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({**user, "exp": int(time.time()) + TOKEN_TTL}).encode()).decode()
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify(token: str) -> Optional[dict]:
    try:
        payload, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload.encode()))
        known = data.get("username") in USERS or (data.get("role") == "demo" and data.get("username") == "demo")
        if data.get("exp", 0) < time.time() or not known:
            return None
        return data
    except Exception:
        return None
