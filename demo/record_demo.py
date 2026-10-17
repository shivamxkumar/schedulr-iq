"""Scripted, high-quality demo recording of SCHEDULR IQ (local app on :5180).

Frames come from Chrome's screencast (rendered at 2x, delivered at 1920x1080) with their
timestamps; encode.sh turns them into a constant-30fps H.264 MP4.
"""
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5180"
API = "http://localhost:8010/api"
OUT = Path(sys.argv[1])
FRAMES = OUT / "frames"
FRAMES.mkdir(parents=True, exist_ok=True)
ADMIN_USER = os.environ["DEMO_ADMIN_USER"]
ADMIN_PASS = os.environ["DEMO_ADMIN_PASS"]


def api(path, body=None, token=None):
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
                                 method="POST" if body is not None else "GET")
    return json.loads(urllib.request.urlopen(req, timeout=120).read() or b"null")


# Clean demo state before recording.
tok = api("/auth/login", {"username": ADMIN_USER, "password": ADMIN_PASS})["token"]
api("/dataset/reset", {}, tok)

OVERLAY = r"""
(() => {
 const boot = () => {
  if (window.__demoReady) return; window.__demoReady = true;
  const css = document.createElement('style');
  css.textContent = `
  #demo-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;
    transition:transform .08s linear}
  #demo-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
  #demo-ring{position:fixed;z-index:2147483646;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
    border:3px solid #D8FF66;opacity:0;pointer-events:none;transform:scale(.4)}
  #demo-ring.on{animation:ring .5s ease-out}
  @keyframes ring{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}
  #demo-cap{position:fixed;left:96px;bottom:28px;z-index:2147483645;max-width:860px;background:#17243B;color:#F7F6F1;
    padding:14px 20px 15px 18px;border-left:5px solid #D8FF66;font-family:'Space Grotesk',system-ui;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);
    opacity:0;transform:translateY(8px);transition:opacity .35s, transform .35s;pointer-events:none}
  #demo-cap.on{opacity:1;transform:none}
  #demo-cap b{display:block;font-size:22px;font-weight:600;letter-spacing:-.01em}
  #demo-cap span{display:block;margin-top:4px;font:400 15px/1.45 Inter,system-ui;color:rgba(247,246,241,.82)}
  #demo-cap i{font-style:normal;font:500 11px 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#D8FF66}
  #demo-card{position:fixed;inset:0;z-index:2147483644;background:#17243B;color:#F7F6F1;display:flex;flex-direction:column;
    justify-content:center;padding:0 140px;font-family:'Space Grotesk',system-ui;opacity:0;transition:opacity .5s;pointer-events:none}
  #demo-card.on{opacity:1}
  #demo-card h1{font-size:96px;font-weight:700;margin:0;letter-spacing:-.03em}
  #demo-card h1 em{font-style:normal;background:#D8FF66;color:#17243B;padding:0 14px;margin-left:8px}
  #demo-card p{font-size:30px;margin:18px 0 0;color:rgba(247,246,241,.85)}
  #demo-card small{display:block;margin-top:36px;font:500 16px 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#D8FF66}
  #demo-card .logo{display:flex;align-items:center;gap:18px;margin-bottom:48px;font-size:26px}
  #demo-card .logo img{width:72px;height:72px;background:#fff;padding:4px;object-fit:contain}`;
  document.head.appendChild(css);
  const cur = document.createElement('div'); cur.id = 'demo-cursor';
  cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1l16 9.5-7 1.5 4 8-3 1.3-4-8L2 18z" fill="#17243B" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div'); ring.id = 'demo-ring';
  const cap = document.createElement('div'); cap.id = 'demo-cap';
  const card = document.createElement('div'); card.id = 'demo-card';
  document.body.append(cur, ring, cap, card);
  addEventListener('mousemove', e => { cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)` }, true);
  addEventListener('mousedown', e => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
    ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on') }, true);
  window.__cap = (kicker, title, body) => {
    if (!title) { cap.classList.remove('on'); return }
    cap.innerHTML = `<i>${kicker}</i><b>${title}</b>${body ? `<span>${body}</span>` : ''}`; cap.classList.add('on') };
  window.__card = (html) => { if (!html) { card.classList.remove('on'); return } card.innerHTML = html; card.classList.add('on') };
 };
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
"""

frames = []


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        ctx.add_init_script(OVERLAY)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)

        def on_frame(ev):
            n = len(frames)
            path = FRAMES / f"f{n:06d}.jpg"
            path.write_bytes(base64.b64decode(ev["data"]))
            frames.append((ev["metadata"]["timestamp"], path.name))
            try:
                cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
            except Exception:
                pass

        cdp.on("Page.screencastFrame", on_frame)
        mouse = {"x": 960, "y": 540}

        def pause(s):
            page.wait_for_timeout(int(s * 1000))

        def move_to(x, y, steps=28):
            page.mouse.move(x, y, steps=steps)
            mouse["x"], mouse["y"] = x, y

        def click(loc, wait=0.6, steps=28):
            loc = loc.first if hasattr(loc, "first") else loc
            loc.scroll_into_view_if_needed(timeout=10000)
            bb = loc.bounding_box()
            move_to(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, steps)
            pause(0.25)
            page.mouse.down(); pause(0.06); page.mouse.up()
            pause(wait)

        def hover(loc, wait=0.8):
            loc = loc.first
            loc.scroll_into_view_if_needed(timeout=10000)
            bb = loc.bounding_box()
            move_to(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
            pause(wait)

        def cap(kicker, title=None, body=None):
            page.evaluate("([k,t,b]) => window.__cap && window.__cap(k,t,b)", [kicker, title, body])

        def card(html):
            page.evaluate("h => window.__card && window.__card(h)", html)

        def scroll(dy, steps=12, each=0.05):
            for _ in range(steps):
                page.mouse.wheel(0, dy / steps)
                pause(each)

        def select(label, value, wait=1.0):
            loc = page.get_by_label(label).first
            hover(loc, 0.3)
            loc.select_option(value)
            pause(wait)

        def step(name, fn):
            try:
                fn()
            except Exception as e:  # keep recording even if one beat misbehaves
                print(f"[step {name}] {type(e).__name__}: {e}", flush=True)

        # --- start ---------------------------------------------------------------------------
        page.goto(BASE + "/#/overview")
        page.evaluate("localStorage.clear()")
        page.goto(BASE + "/?demo=1#/overview")
        page.wait_for_load_state("networkidle")
        cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": 1920, "maxHeight": 1080, "everyNthFrame": 1})
        t0 = time.time()

        def intro():
            card('<div class="logo"><img src="/iiit-surat-logo.png">Indian Institute of Information Technology Surat</div>'
                 '<h1>SCHEDULR<em>IQ</em></h1><p>Every slot has a reason.</p>'
                 '<p style="font-size:22px;margin-top:28px;max-width:1100px">Conflict-free timetables with constraint optimization (OR-Tools CP-SAT), '
                 'independently validated, explained session by session — demonstrated on IIIT Surat\'s official odd-semester timetable.</p>'
                 '<small>PS-6 · Intelligent College Timetable Optimization</small>')
            pause(4.5)
            card(None); pause(0.8)

        def login_demo():
            cap("01 · Access", "Institute login with roles", "Administrators edit data and publish, viewers read. "
                "Judges can open a no-sign-in demo of the real IIIT Surat timetable.")
            hover(page.get_by_text("Administrator"), 1.2)
            click(page.get_by_role("button", name="View demo"), 2.2)

        def overview():
            cap("02 · Overview", "Is the timetable feasible, efficient and ready to publish?",
                "The official v4 timetable: 281 sessions, no clashes, but 18 class-days without a lunch hour. "
                "Every number comes from the independent validator.")
            pause(3.5)
            move_to(1200, 640)
            scroll(700, 16); pause(2.2)
            scroll(700, 16); pause(2.4)
            scroll(-1400, 16); pause(1)

        def class_view():
            click(page.get_by_role("button", name="Timetable"), 1.5)
            cap("03 · Timetable", "Official sheet format: days in rows, periods in columns",
                "Lectures are whole-class; G1/G2 labs run side by side. The lime columns are the 12:00–14:00 lunch window.")
            pause(3.5)
            select("Class / batch", "S5-CSE", 1.6)
            cap("03 · Timetable", "S5-CSE has no lunch hour on three days",
                "Red outlines mark genuine hard violations found by the validator, not preferences.")
            pause(2.6)
            bad = page.locator("button.ring-conflict")
            click(bad, 2.2)
            cap("03 · Explainability", "Click any class to see why it is there",
                "Hard checks for this session, the exact violation, and a map of every alternative slot.")
            insp = page.locator("aside").first
            pause(2.4)
            insp.hover()
            for _ in range(3):
                page.mouse.wheel(0, 260); pause(0.9)
            pause(1.8)
            click(page.get_by_role("button", name="Close inspector"), 0.8)

        def other_views():
            click(page.get_by_role("tab", name="Faculty"), 1.4)
            cap("03 · Timetable", "Faculty timetable", "Same layout per teacher — each cell shows the class.")
            pause(2.6)
            select("Faculty", "PJM", 1.8)
            click(page.get_by_role("tab", name="Room"), 1.4)
            cap("03 · Timetable", "Room timetable", "Occupancy of a classroom or lab across the week.")
            select("Room", "ECE-LAB-3", 2.2)
            click(page.get_by_role("tab", name="All classes"), 1.6)
            cap("03 · Timetable", "All 14 classes", "B.Tech Sem 1/3/5/7 and three M.Tech programmes, each as an official-style sheet.")
            move_to(1100, 640)
            scroll(1600, 24, 0.07); pause(1.2); scroll(1600, 24, 0.07); pause(1.0)
            scroll(-3200, 10); pause(0.6)
            click(page.get_by_role("tab", name="Class"), 1.0)

        def lab():
            click(page.get_by_role("button", name="Optimize"), 1.6)
            cap("04 · Optimization Lab", "Hard constraints are never traded for score",
                "Five weighted soft objectives on the left; 20 hard rules enforced by CP-SAT and re-checked independently.")
            pause(3.2)
            hover(page.get_by_text("Student-first"), 0.6)
            hover(page.get_by_text("Hard constraints").first, 1.5)
            page.locator("header select").first.select_option(index=1)
            pause(2.0)
            cap("04 · Optimization Lab", "Official vs optimized — measured, not claimed",
                "All 18 missing lunch hours repaired, idle time cut by two thirds; the uneven-workload trade-off is shown honestly.")
            move_to(1250, 600)
            scroll(560, 14); pause(3.5)
            scroll(520, 14); pause(3.0)
            scroll(600, 14); pause(2.5)
            scroll(-1700, 10); pause(0.6)

        def live_run():
            page.locator("header select").first.select_option(index=0)
            pause(1.0)
            tl = page.locator("input[type=number]").first
            click(tl, 0.3)
            tl.fill("15"); pause(0.4)
            click(page.get_by_role("button", name="Student-first"), 0.6)
            cap("04 · Live run", "Run the optimizer live", "CP-SAT, warm-started from the official timetable; the result is validated before it is stored.")
            click(page.get_by_role("button", name="Optimize timetable"), 0.5)
            page.wait_for_selector("text=Run status", timeout=60000)
            pause(16.5)
            page.wait_for_function("() => !document.querySelector('button[disabled] .animate-spin')", timeout=90000)
            pause(1.5)
            cap("04 · Live run", "New run stored as its own version",
                "Status, model size, the measured before/after table and a change log — the baseline is never overwritten.")
            move_to(1250, 600)
            scroll(1100, 16); pause(3.0)
            scroll(900, 16); pause(2.8)
            scroll(-2000, 10); pause(0.5)

        def compare_and_move():
            click(page.get_by_role("button", name="Timetable"), 1.4)
            select("Class / batch", "S5-CSE", 1.2)
            cap("05 · After optimization", "S5-CSE now has a lunch hour every day", "Toggle the comparison to see where classes moved from.")
            pause(2.0)
            click(page.get_by_role("button", name="Compare to baseline"), 2.8)
            click(page.get_by_role("button", name="Compare to baseline"), 0.6)
            blocks = page.locator("button[draggable=true]")
            click(blocks.nth(3), 2.0)
            cap("05 · Manual edits", "Every move is validated before it is accepted", "Grey cells are blocked — the validator explains why.")
            insp = page.locator("aside").first
            insp.hover(); page.mouse.wheel(0, 420); pause(1.2)
            blocked = page.locator('aside button[aria-label*="already"], aside button[aria-label*="unavailable"], aside button[aria-label*="lunch"]')
            if blocked.count():
                click(blocked, 2.6)
            feas = page.locator('aside button[aria-label*="feasible in"]')
            if feas.count():
                cap("05 · Manual edits", "A valid move is saved as a new version", "With one-click Undo.")
                click(feas.last, 3.0)
            page.keyboard.press("Escape")
            close = page.get_by_role("button", name="Close inspector")
            if close.count():
                click(close, 0.6)

        def conflicts():
            click(page.get_by_role("button", name="Conflicts"), 1.6)
            cap("06 · Conflict inspector", "Independent validator with corrective actions",
                "A labelled diagnostic example: deliberately corrupted copy to show detection and validated fixes.")
            click(page.get_by_role("button", name="Load diagnostic example"), 2.6)
            move_to(800, 600); scroll(300, 8); pause(2.0)
            fix = page.locator("main button:has-text('→')")
            if fix.count():
                cap("06 · Conflict inspector", "Apply a validated fix", "Each suggestion was re-checked before being offered; the count drops.")
                click(fix, 2.8)
            scroll(-400, 6); pause(1.0)

        def resources():
            click(page.get_by_role("button", name="Resources"), 1.6)
            cap("07 · Resources", "Rooms, labs, faculty load, batches and courses",
                "Utilization is computed from the active timetable; occupancy maps use the same day × period layout.")
            pause(2.2)
            rows = page.locator("main table tbody tr")
            if rows.count() > 2:
                click(rows.nth(1), 2.0)
            move_to(1100, 700); scroll(500, 10); pause(2.0)
            scroll(-500, 8)
            click(page.locator("main [role=tab]").filter(has_text="Faculty"), 1.6)
            pause(1.6)

        def admin_setup():
            cap("08 · Administrator", "Sign in as the timetable office", None)
            click(page.get_by_role("button", name="Sign out"), 1.6)
            user = page.locator("input[autocomplete=username]")
            click(user, 0.2); user.type(ADMIN_USER, delay=70)
            pw = page.locator("input[autocomplete=current-password]")
            click(pw, 0.2); pw.type(ADMIN_PASS, delay=55)
            click(page.get_by_role("button", name="Sign in"), 2.0)
            click(page.get_by_role("button", name="Setup"), 1.6)
            cap("08 · Admin input", "Faculty, rooms, labs, batches, courses and availability",
                "Everything the problem statement asks for, entered in forms — checked live against the solver.")
            click(page.locator("main button:has-text('Dr. Neel')").first if page.locator("main button:has-text('Dr. Neel')").count() else page.locator("main aside button, main div button").filter(has_text="Dr.").first, 1.6)
            move_to(1200, 650); scroll(650, 12); pause(1.6)
            cap("08 · Admin input", "Paint weekly availability", "Unavailable is a hard constraint; 'prefers not' is a soft objective.")
            cells = page.locator('table button[title*="Available"]')
            if cells.count() > 30:
                click(cells.nth(30), 0.8); click(cells.nth(31), 1.6)
            pause(1.6)
            discard = page.get_by_role("button", name="Discard")
            if discard.is_enabled():
                click(discard, 1.0)
            scroll(-900, 8)
            click(page.get_by_role("tab", name="Calendar"), 1.6)
            cap("08 · Admin input", "Calendar and student lunch window",
                "Working days, slot length, breaks, half-days — and the lunch window every class must get.")
            move_to(1300, 650); pause(3.2)

        def import_publish():
            click(page.get_by_role("button", name="Import"), 1.4)
            cap("09 · Import", "CSV import with row-level validation", "Templates, export, demo restore and infeasible scenarios that are explained, not hidden.")
            move_to(1100, 650); scroll(900, 14); pause(2.0); scroll(-900, 8)
            sel = page.locator("header select").first
            opts = sel.locator("option").all_text_contents()
            idx = next((i for i, o in enumerate(opts) if "precomputed" in o), 1)
            sel.select_option(index=idx); pause(1.0)
            click(page.get_by_role("button", name="Publish"), 1.6)
            cap("10 · Publish", "20 hard checks verified before publishing",
                "Invalid or diagnostic schedules can never be published. CSV export and per-class print sheets.")
            pause(2.0)
            btn = page.get_by_role("button", name="Mark as final & publish")
            if btn.count() and btn.is_enabled():
                click(btn, 2.4)
            move_to(1100, 700)
            scroll(900, 16); pause(2.4); scroll(900, 16); pause(2.4)
            scroll(-1800, 8); pause(0.5)

        def outro():
            cap(None)
            card('<div class="logo"><img src="/iiit-surat-logo.png">Indian Institute of Information Technology Surat</div>'
                 '<h1>SCHEDULR<em>IQ</em></h1>'
                 '<p>Valid timetable · independently verified · optimized · explained</p>'
                 '<p style="font-size:22px;margin-top:26px">FastAPI · OR-Tools CP-SAT · React · 24 automated tests</p>'
                 '<small>schedulr-iq-iiit-surat.onrender.com · github.com/shivamxkumar/schedulr-iq</small>')
            pause(5)

        for name, fn in [("intro", intro), ("login", login_demo), ("overview", overview), ("class", class_view),
                         ("views", other_views), ("lab", lab), ("live", live_run), ("move", compare_and_move),
                         ("conflicts", conflicts), ("resources", resources), ("admin", admin_setup),
                         ("publish", import_publish), ("outro", outro)]:
            print(f"[{time.time() - t0:6.1f}s] {name}", flush=True)
            step(name, fn)

        cdp.send("Page.stopScreencast")
        end_ts = frames[-1][0] + 1.0 if frames else 0
        browser.close()

    # concat list with real frame durations
    with open(OUT / "frames.txt", "w") as fh:
        for i, (ts, name) in enumerate(frames):
            nxt = frames[i + 1][0] if i + 1 < len(frames) else end_ts
            fh.write(f"file 'frames/{name}'\nduration {max(0.001, nxt - ts):.4f}\n")
        fh.write(f"file 'frames/{frames[-1][1]}'\n")
    print(f"frames={len(frames)} span={frames[-1][0] - frames[0][0]:.1f}s", flush=True)


main()
