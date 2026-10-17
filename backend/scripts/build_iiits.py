"""Build the IIIT Surat demo dataset + official reference timetable.

Source: backend/data_src/iiit_surat_all_class_v4.txt, a hand transcription of the Timetable
Committee's `all_class_v4.pdf` (14 class timetables, Mon–Fri, 09:00–18:00).

Modelling choices (documented in the README):
  * A class (e.g. "B.Tech CSE Sem 1 Sec B") becomes one *section*; it is split into atomic
    student batches by lab group (G1/G2) and elective division (D1/D2/D3) when the class
    timetable uses them. A whole-class lecture attends every atom; a group lab attends half.
  * Sessions printed identically on several class timetables (cross-listed electives, common
    M.Tech courses) are merged into one session attended by all those batches.
  * Back-to-back hours of the same course, room and faculty are merged into one block.
  * The first listed non-scholar teacher is the session's assigned faculty; teaching
    assistants / research scholars (PG25…, RS25…) are not modelled.
  * An "offering" is (course code, batches, faculty, kind); offerings never meet twice on a day.
  * Enrollment and room capacities are not public; they are assumed (see SIZES / CAPACITY).
  * Faculty availability is not public: everyone is available; 17:00–18:00 is marked
    "prefers not" (soft) so the optimizer has a realistic preference to respect.

Run:  cd backend && .venv/bin/python scripts/build_iiits.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data_src" / "iiit_surat_all_class_v4.txt"
OUT = ROOT / "app" / "iiits_official.json"
DAYS = ["Mo", "Tu", "We", "Th", "Fr"]

SIZES = {"S1-ECEA": 70, "S1-CSEB": 70, "S1-CSEC": 70, "S1-CSED": 70, "S3-ECE": 68, "S3-CSEA": 70, "S3-CSEB": 70,
         "S5-ECE": 60, "S5-CSE": 72, "S7-ECE": 60, "S7-CSE": 72, "MT-ECE": 18, "MT-CSE": 20, "MT-DSC": 18}

# Initials → public faculty pages (iiitsurat.ac.in, CSE/ECE/MSA/PSA). "inferred" = plausible
# match by initials only; "unlisted" = not found on the public faculty pages.
FACULTY = {
    "ND": ("Dr. Nishad Gopal Deshpande", "Physical & Applied Sciences", "matched"),
    "BP": ("Dr. Bikash Patra", "Physical & Applied Sciences", "matched"),
    "KY": ("Dr. Khamosh Yadav", "Physical & Applied Sciences", "matched"),
    "APS": ("Dr. Anand Pratap Singh", "Mathematical & Computational Sciences", "matched"),
    "AP": ("Dr. Aarti Patle", "Mathematical & Computational Sciences", "matched"),
    "VP": ("Dr. Vijay Kumar Patel", "Mathematical & Computational Sciences", "matched"),
    "PS": ("Dr. Pradeep Singh", "Mathematical & Computational Sciences / CSE", "matched"),
    "NB": ("Dr. Nayan Behera", "Computer Science & Engineering", "matched"),
    "DR": ("Dr. Diksha Rangwani", "Computer Science & Engineering", "matched"),
    "AD": ("Dr. Abisek Dahal", "Computer Science & Engineering", "matched"),
    "PJM": ("Dr. Prarthana Jagat Mehta", "Computer Science & Engineering", "matched"),
    "RN": ("Dr. Rachit Nimavat", "Computer Science & Engineering", "matched"),
    "RK": ("Dr. Ritesh Kumar", "Computer Science & Engineering", "matched"),
    "KD": ("Dr. Kaustubh Dhondge", "Computer Science & Engineering / ECE", "matched"),
    "RDM": ("Dr. Rahul Dev Mishra", "Electronics & Communication Engineering", "matched"),
    "NA": ("Dr. Neelima Agrawal", "Electronics & Communication Engineering", "matched"),
    "VAP": ("Dr. Venkata Annapurna Priyadarshini Chavali", "Electronics & Communication Engineering", "matched"),
    "SM": ("Dr. Shikha Maurya", "Electronics & Communication Engineering", "matched"),
    "TD": ("Dr. Tanmay Dubey", "Electronics & Communication Engineering", "matched"),
    "HG": ("Dr. Hemantkumar Sahijram Goklani", "Electronics & Communication Engineering", "matched"),
    "MR": ("Dr. Manish Kumar Rai", "Electronics & Communication Engineering", "matched"),
    "LC": ("Dr. Lokendra Chouhan", "Electronics & Communication Engineering", "matched"),
    "DP": ("Dr. Dhiraj Kumar Patel", "Electronics & Communication Engineering", "matched"),
    "SVR": ("Dr. Sivavenkateswara Rao V.", "Electronics & Communication Engineering", "matched"),
    "SKS": ("Dr. Sameer Kumar Singh", "Electronics & Communication Engineering", "matched"),
    "RRP": ("Dr. Reema Patel", "Computer Science & Engineering", "inferred"),
    "DN": ("Dr. Nidhi Nitin Desai", "Computer Science & Engineering", "inferred"),
    "TG": ("Ms. Trupti Gondaliya", "Computer Science & Engineering", "inferred"),
    "SA": ("Dr. Shreya Agarwal", "Computer Science & Engineering", "inferred"),
    "RP": ("Mr. Rahul K Patel", "Electronics & Communication Engineering", "inferred"),
    "SR": ("SR (initials only)", "Not on public faculty pages", "unlisted"),
    "SRS": ("SRS (initials only)", "Not on public faculty pages", "unlisted"),
}
PLACEHOLDER = {"PAS": "Physical & Applied Sciences", "HSS": "Humanities & Social Sciences"}

# Course names from the public IIIT Surat curricula (2025 for Sem 1/3, 2023 NEP for Sem 5/7).
NAMES = {
    "AS 101": "Engineering Physics", "AS 102": "Fundamentals of Biological Sciences",
    "CS 101": "Fundamentals of Computer & C Programming", "MS 101": "Engineering Mathematics",
    "MS 101T": "Engineering Mathematics (Tutorial)", "EC 101": "ICT Workshop - I",
    "EC 102": "Introduction to Electrical Engineering", "HS 101": "Communication Skills and Personality Development",
    "CS 301": "Computer Organization and Architecture", "CS 302": "Object Oriented Programming",
    "CS 303": "Programming for Problem Solving", "CS 304": "Database Management Systems", "CS 305": "Software Engineering",
    "EC 301": "Signal and Systems", "EC 302": "Electronics Devices and Circuits", "EC 303": "Sensors and Instrumentation",
    "HS 301": "Economics & Business Management",
    "CS 501": "Data Science", "CS 502": "Computer Graphics", "CS 503": "High Performance Computing",
    "CS 504": "Cloud Computing & Big Data Infrastructure", "CS 514": "Fuzzy & Neural Networks (elective)",
    "EC 501": "Wireless Communication", "EC 502": "Nanoscale Device Engineering",
    "EC 503": "Image Processing & Computer Vision", "EC 513": "Hardware Description Languages (elective)",
    "HM 505": "Innovation & Entrepreneurship",
    "CS 701": "Artificial Intelligence", "CS 702": "Natural Language Processing", "EC 702": "Electric Vehicle Technology",
    "CS 742": "Cyber Security (elective)", "CS 743": "Deep Learning (elective)", "CS 753": "Wireless Communication (elective)",
    "EC 761": "VLSI Testing & Verification (elective)",
}
LAB_EQUIP = {"CSE": "computers", "ECE": "electronics", "PHY": "physics"}


def norm_code(c: str) -> str:
    return "/".join(re.sub(r"\s+", " ", x.strip()) for x in c.split("/"))


def name_for(code: str) -> str:
    parts = code.split("/")
    for p in parts:
        if p in NAMES:
            return NAMES[p] + (f" · cross-listed {code}" if len(parts) > 1 else "")
    return f"{code} · M.Tech course (name not in public curriculum)"


def category(code: str) -> str:
    c = code.split("/")[0]
    if c.startswith(("CS",)):
        return "cs"
    if c.startswith(("EC",)):
        return "ece"
    if c.startswith("MS"):
        return "math"
    if c.startswith("AS"):
        return "sci"
    return "hum"


def parse():
    sections, entries, cur = {}, [], None
    for line in SRC.read_text().splitlines():
        if line.startswith("== "):
            sid, title = [x.strip() for x in line[3:].split("|")]
            sections[sid] = title
            cur = sid
            continue
        if not line.strip() or line.startswith("#"):
            continue
        head, room, fac = [x.strip() for x in line.split("|")]
        day, slot, dur, grp, *code = head.split()
        entries.append(dict(sec=cur, day=DAYS.index(day), start=int(slot), dur=int(dur), grp=grp,
                            code=norm_code(" ".join(code)), room=room, fac=[f.strip() for f in fac.split("/")]))
    return sections, entries


def atoms_of(sections, entries):
    dims = {}
    for s in sections:
        es = [e for e in entries if e["sec"] == s]
        groups = sorted({e["grp"] for e in es if e["grp"].startswith("G")})
        divs = sorted({e["grp"] for e in es if e["grp"].startswith("D")})
        groups = ["G1", "G2"] if groups else [""]
        divs = [f"D{i}" for i in range(1, max(int(d[1]) for d in divs) + 1)] if divs else [""]
        dims[s] = [g + d for g in groups for d in divs]
    return dims


def main():
    sections, entries = parse()
    dims = atoms_of(sections, entries)

    def batch_ids(e):
        a = dims[e["sec"]]
        if e["grp"] == "-":
            sel = a
        else:
            sel = [x for x in a if e["grp"] in x]
        return [f"{e['sec']}{('-' + x) if x else ''}" for x in sel]

    # 1. merge back-to-back identical hours within a section
    entries.sort(key=lambda e: (e["sec"], e["grp"], e["code"], e["day"], e["start"]))
    merged = []
    for e in entries:
        p = merged[-1] if merged else None
        if p and all(p[k] == e[k] for k in ("sec", "grp", "code", "day", "room")) and p["fac"] == e["fac"] \
                and p["start"] + p["dur"] == e["start"]:
            p["dur"] += e["dur"]
        else:
            merged.append(dict(e))
    # 2. merge identical sessions across class timetables
    sessions = {}
    for e in merged:
        key = (e["day"], e["start"], e["dur"], e["room"], e["code"])
        s = sessions.setdefault(key, dict(e, batches=set(), secs=set()))
        s["batches"].update(batch_ids(e))
        s["secs"].add(e["sec"])

    # 3. primary faculty
    def primary(e):
        for f in e["fac"]:
            if f.startswith(("PG", "RS")):
                continue
            m = re.match(r"(PAS|HSS) (F\d)", f)
            if m:
                return f"{m.group(1)}-{m.group(2)}-{e['code'].replace(' ', '')}"
            return f
        return e["fac"][0]

    # 4. offerings
    offer_sessions = defaultdict(list)
    for s in sessions.values():
        is_lab_room = "LAB" in s["room"]
        kind = "lab" if is_lab_room and s["dur"] >= 2 else ("tut" if s["code"].endswith("T") else "lec")
        okey = (s["code"], frozenset(s["batches"]), primary(s), kind)
        offer_sessions[okey].append(s)

    courses, official, fac_courses = [], [], defaultdict(set)
    used_ids = set()
    for (code, batches, fac, kind), lst in sorted(offer_sessions.items(), key=lambda kv: (kv[0][0], sorted(kv[0][1]))):
        lst.sort(key=lambda s: (s["day"], s["start"]))
        # split so an offering meets at most once per day
        buckets: list[list] = []
        for s in lst:
            for b in buckets:
                if all(x["day"] != s["day"] for x in b) and b[0]["dur"] == s["dur"]:
                    b.append(s)
                    break
            else:
                buckets.append([s])
        secs = sorted({sec for s in lst for sec in s["secs"]})
        for bi, b in enumerate(buckets):
            base = f"{code.split('/')[0].replace(' ', '')}{'L' if kind == 'lab' else 'T' if kind == 'tut' else ''}-" \
                   f"{'+'.join(x.replace('-', '') for x in secs)}"
            tags = set()
            for sec in secs:
                members = [f"{sec}{('-' + a) if a else ''}" for a in dims[sec]]
                have = {m for m in members if m in batches}
                if have == set(members):
                    continue  # whole class: no group label
                for key in ("G1", "G2", "D1", "D2", "D3"):
                    full = {m for m in members if key in m[len(sec) + 1:]}
                    if full and full == have:
                        tags.add(key)
                        break
                else:
                    tags.update(m[len(sec) + 1:] for m in have)
            cid = f"{base}-{'.'.join(sorted(tags))}" if tags else base
            n = 1
            while (cid if n == 1 else f"{cid}-{n}") in used_ids:
                n += 1
            cid = cid if n == 1 else f"{cid}-{n}"
            used_ids.add(cid)
            rooms = {s["room"] for s in b}
            lab_rooms = [r for r in rooms if "LAB" in r]
            if kind == "lab":
                room_types = ["lab"]
                cats = {r.split()[0] for r in lab_rooms}
                equipment = [LAB_EQUIP[cats.pop()]] if len(cats) == 1 else []
            else:
                room_types = ["lecture", "lab"] if lab_rooms else ["lecture"]
                equipment = []
            display = code.replace("T", "") if code.endswith("T") else code
            courses.append(dict(
                id=cid, code=display, name=name_for(code) + (" · Lab" if kind == "lab" else ""),
                course_type={"lab": "lab", "tut": "tutorial", "lec": "lecture"}[kind], category=category(code),
                batch_ids=sorted(batches), sessions_per_week=len(b), duration_slots=b[0]["dur"],
                room_types=room_types, equipment=equipment, eligible_starts=[]))
            fac_courses[fac].add(cid)
            for k, s in enumerate(b):
                official.append(dict(session_id=f"{cid}-S{k + 1}", day=s["day"], start=s["start"], room_id=s["room"].replace(" ", "-"),
                                     faculty_id=fac))

    # 5. batches
    batches = []
    for sec, atoms in dims.items():
        size = SIZES[sec]
        for a in atoms:
            label = " · ".join(("lab group " + a[:2]) if p == 0 else ("elective div " + a[3])
                               for p in range(2) if (p == 0 and a.startswith("G")) or (p == 1 and "D" in a)) if a else ""
            if a and a.startswith("D"):
                label = "elective div " + a[1]
            batches.append(dict(id=f"{sec}{('-' + a) if a else ''}", name=f"{sections[sec]}{(' · ' + label) if label else ''}",
                                size=max(1, round(size / len(atoms))), program=sections[sec], section=sec))
    bsize = {b["id"]: b["size"] for b in batches}

    # 6. rooms: capacities assumed, raised to the largest observed combined class
    need = defaultdict(int)
    for c in courses:
        enr = sum(bsize[b] for b in c["batch_ids"])
        for a in official:
            if a["session_id"].startswith(c["id"] + "-S"):
                need[a["room_id"]] = max(need[a["room_id"]], enr)
    rooms = []
    for rid in sorted(need):
        lab = "LAB" in rid
        base = 40 if lab else 80
        cap = max(base, -(-need[rid] // 10) * 10)
        equip = [LAB_EQUIP[rid.split("-")[0]]] if lab else ["projector"]
        name = rid.replace("-", " ").replace("CR", "Classroom").replace("LAB", "Lab")
        rooms.append(dict(id=rid, name=name, capacity=cap, room_type="lab" if lab else "lecture", equipment=equip,
                          unavailable=[]))

    # 7. faculty with loads derived from the official timetable (+ headroom)
    dur = {c["id"]: c["duration_slots"] for c in courses}
    daily, weekly = defaultdict(int), defaultdict(int)
    for a in official:
        d = dur[a["session_id"].rsplit("-S", 1)[0]]
        daily[(a["faculty_id"], a["day"])] += d
        weekly[a["faculty_id"]] += d
    faculty = []
    for fid in sorted(fac_courses):
        if fid in FACULTY:
            name, dept, status = FACULTY[fid]
        else:
            m = re.match(r"(PAS|HSS)-(F\d)-(.+)", fid)
            name = f"{m.group(1)} faculty {m.group(2)} · {m.group(3)} (to be assigned)" if m else fid
            dept, status = (PLACEHOLDER.get(m.group(1), "") if m else ""), "placeholder"
        mx = max(daily[(fid, d)] for d in range(5))
        faculty.append(dict(id=fid, name=name, department=f"{dept} · initials {fid.split('-')[0]} ({status})",
                            courses=sorted(fac_courses[fid]), unavailable=[],
                            dispreferred=[dict(day=d, start=8, end=9) for d in range(5)],
                            max_daily_slots=max(mx, 4), max_weekly_slots=weekly[fid] + 4))

    dataset = dict(
        name="IIIT Surat · Odd Semester 2025–26 (official v4 timetable)",
        time=dict(days=["Mon", "Tue", "Wed", "Thu", "Fri"], day_start="09:00", slot_minutes=60, slots_per_day=9,
                  break_slots=[], day_slots=[9] * 5),
        rooms=rooms, faculty=faculty, batches=batches, courses=courses, fixed=[])
    payload = {"dataset": dataset, "official": official,
               "source": "Timetable Committee, IIIT Surat — all_class_v4.pdf (aSc Timetables)"}
    payload["optimized"] = precompute(dataset, official)
    OUT.write_text(json.dumps(payload, indent=1))
    print(f"sections={len(sections)} batches={len(batches)} rooms={len(rooms)} faculty={len(faculty)} "
          f"offerings={len(courses)} sessions={len(official)} → {OUT.relative_to(ROOT)}")


def precompute(dataset: dict, official: list[dict], time_limit: float = 30.0) -> dict:
    """One CP-SAT run with default weights, stored so the read-only demo shows a real comparison
    instantly. It is re-validated by the app at load time."""
    import sys
    sys.path.insert(0, str(ROOT))
    from app.metrics import compute_metrics, term_refs
    from app.models import Assignment, Dataset, Weights
    from app.solver import solve
    from app.validator import validate
    ds = Dataset.model_validate(dataset)
    base = [Assignment(**a) for a in official]
    refs = term_refs(compute_metrics(ds, base).terms)
    res = solve(ds, Weights(), refs, hint=base, time_limit=time_limit)
    rep = validate(ds, res.assignments)
    assert rep.feasible and rep.complete, "precomputed optimum failed validation"
    return {"assignments": [a.model_dump() for a in res.assignments], "weights": Weights().model_dump(),
            "solver": {"method": "OR-Tools CP-SAT (weighted soft objective, warm-started from the official timetable); "
                                 "precomputed at build time", "status": res.status, "message": res.message,
                       "wall_seconds": res.wall_seconds, "objective": res.objective, "best_bound": res.best_bound,
                       "variables": res.num_variables, "constraints": res.num_constraints, "candidates": res.num_candidates,
                       "time_limit": time_limit, "log": res.log}}


if __name__ == "__main__":
    main()
