"""Small synthetic campus used by unit tests and diagnostic scenarios (all names fictional): 4 batches, 7 rooms, 8 faculty, 12 course codes (16 offerings, 40 weekly sessions).

Built-in scheduling challenges:
  * MA201 is a combined CSE-2A + CSE-2B lecture (118 students) - only LH-101 (130) fits.
  * Dr. Neel Banerjee (visiting) is unavailable Tue/Thu/Sat, and MA211 needs 3 sessions on
    distinct days, so MA211 can only run Mon/Wed/Fri - and needs a 90+ seat hall.
  * Three 3-hour labs (CS291A, CS291B, DS391) compete for the single computing lab, which is
    closed on Saturday; 3-hour blocks only fit 09:00-12:00 or 14:00-17:00 around lunch.
  * The electronics lab is technician-staffed in the afternoon only (eligible starts).
  * Several faculty prefer not to teach early mornings / afternoons, which competes with
    compact (gap-free) student days and right-sized rooms - weights produce real trade-offs.
"""
from __future__ import annotations

from .models import Batch, Course, Dataset, Faculty, Room, TimeConfig, Window

WEEKDAYS = range(5)


def _day(d: int, start: int = 0, end: int = 8) -> Window:
    return Window(day=d, start=start, end=end)


def demo_dataset() -> Dataset:
    rooms = [
        Room(id="LH-101", name="Main Lecture Hall", capacity=130, room_type="lecture",
             equipment=["projector"], unavailable=[_day(2, 5, 8)]),
        Room(id="LH-102", name="Lecture Hall 102", capacity=90, room_type="lecture", equipment=["projector"]),
        Room(id="CR-201", name="Classroom 201", capacity=64, room_type="lecture", equipment=["projector"]),
        Room(id="CR-202", name="Classroom 202", capacity=60, room_type="lecture", equipment=[]),
        Room(id="SR-301", name="Seminar Room 301", capacity=40, room_type="seminar", equipment=["projector"]),
        Room(id="LAB-CS1", name="Computing Lab 1", capacity=64, room_type="lab",
             equipment=["computers", "projector"], unavailable=[_day(5)]),
        Room(id="LAB-EL", name="Electronics Lab", capacity=50, room_type="lab", equipment=["electronics"]),
    ]
    batches = [
        Batch(id="CSE-2A", name="CSE Year 2 · Section A", size=62, program="B.Tech CSE"),
        Batch(id="CSE-2B", name="CSE Year 2 · Section B", size=56, program="B.Tech CSE"),
        Batch(id="ECE-2", name="ECE Year 2", size=48, program="B.Tech ECE"),
        Batch(id="DS-3", name="CSE (AI & DS) Year 3", size=38, program="B.Tech CSE (AI & DS)"),
    ]
    afternoons = [Window(day=d, start=5, end=8) for d in WEEKDAYS]
    courses = [
        Course(id="MA201", code="MA201", name="Discrete Mathematics", course_type="lecture", category="math",
               batch_ids=["CSE-2A", "CSE-2B"], sessions_per_week=3, duration_slots=1,
               room_types=["lecture"], equipment=["projector"]),
        Course(id="MA201-TA", code="MA201T", name="Discrete Maths Tutorial · A", course_type="tutorial",
               category="math", batch_ids=["CSE-2A"], sessions_per_week=1, duration_slots=1,
               room_types=["seminar", "lecture"]),
        Course(id="MA201-TB", code="MA201T", name="Discrete Maths Tutorial · B", course_type="tutorial",
               category="math", batch_ids=["CSE-2B"], sessions_per_week=1, duration_slots=1,
               room_types=["seminar", "lecture"]),
        Course(id="CS201-A", code="CS201", name="Data Structures · A", course_type="lecture", category="cs",
               batch_ids=["CSE-2A"], sessions_per_week=4, duration_slots=1,
               room_types=["lecture"], equipment=["projector"]),
        Course(id="CS201-B", code="CS201", name="Data Structures · B", course_type="lecture", category="cs",
               batch_ids=["CSE-2B"], sessions_per_week=4, duration_slots=1,
               room_types=["lecture"], equipment=["projector"]),
        Course(id="CS202-A", code="CS202", name="Object-Oriented Programming · A", course_type="lecture",
               category="cs", batch_ids=["CSE-2A"], sessions_per_week=3, duration_slots=1, room_types=["lecture"]),
        Course(id="CS202-B", code="CS202", name="Object-Oriented Programming · B", course_type="lecture",
               category="cs", batch_ids=["CSE-2B"], sessions_per_week=3, duration_slots=1, room_types=["lecture"]),
        Course(id="CS291-A", code="CS291", name="Data Structures Lab · A", course_type="lab", category="cs",
               batch_ids=["CSE-2A"], sessions_per_week=1, duration_slots=3,
               room_types=["lab"], equipment=["computers"]),
        Course(id="CS291-B", code="CS291", name="Data Structures Lab · B", course_type="lab", category="cs",
               batch_ids=["CSE-2B"], sessions_per_week=1, duration_slots=3,
               room_types=["lab"], equipment=["computers"]),
        Course(id="EC201", code="EC201", name="Signals & Systems", course_type="lecture", category="ece",
               batch_ids=["ECE-2"], sessions_per_week=4, duration_slots=1, room_types=["lecture"]),
        Course(id="EC202", code="EC202", name="Digital Logic Design", course_type="lecture", category="ece",
               batch_ids=["ECE-2"], sessions_per_week=3, duration_slots=1, room_types=["lecture"]),
        Course(id="EC291", code="EC291", name="Electronics Lab", course_type="lab", category="ece",
               batch_ids=["ECE-2"], sessions_per_week=2, duration_slots=2,
               room_types=["lab"], equipment=["electronics"], eligible_starts=afternoons),
        Course(id="MA211", code="MA211", name="Probability & Statistics", course_type="lecture", category="math",
               batch_ids=["ECE-2", "DS-3"], sessions_per_week=3, duration_slots=1,
               room_types=["lecture"], equipment=["projector"]),
        Course(id="DS301", code="DS301", name="Machine Learning", course_type="lecture", category="ds",
               batch_ids=["DS-3"], sessions_per_week=4, duration_slots=1,
               room_types=["lecture", "seminar"], equipment=["projector"]),
        Course(id="DS391", code="DS391", name="Machine Learning Lab", course_type="lab", category="ds",
               batch_ids=["DS-3"], sessions_per_week=1, duration_slots=3,
               room_types=["lab"], equipment=["computers"]),
        Course(id="DS303", code="DS303", name="Research Seminar", course_type="tutorial", category="ds",
               batch_ids=["DS-3"], sessions_per_week=2, duration_slots=1, room_types=["seminar"]),
    ]
    faculty = [
        Faculty(id="F01", name="Dr. Ananya Rao", department="Mathematics",
                courses=["MA201", "MA201-TA", "MA201-TB"], unavailable=[_day(5)],
                dispreferred=[_day(4, 5, 8)], max_daily_slots=3, max_weekly_slots=10),
        Faculty(id="F02", name="Prof. Vikram Menon", department="Computer Science",
                courses=["CS201-A", "CS201-B", "CS202-A"],
                dispreferred=[_day(5)] + [_day(d, 0, 2) for d in WEEKDAYS],
                max_daily_slots=4, max_weekly_slots=12),
        Faculty(id="F03", name="Dr. Meera Iyer", department="Computer Science",
                courses=["CS201-A", "CS201-B", "CS202-A", "CS202-B", "CS291-A", "CS291-B"],
                dispreferred=[_day(5)] + [_day(d, 5, 8) for d in (0, 1, 2)], max_daily_slots=4, max_weekly_slots=16),
        Faculty(id="F04", name="Dr. Arjun Kapoor", department="Computer Science",
                courses=["CS291-A", "CS291-B", "DS391"], unavailable=[_day(0)],
                max_daily_slots=4, max_weekly_slots=12),
        Faculty(id="F05", name="Dr. Kavita Sharma", department="Electronics",
                courses=["EC201", "EC202", "EC291"], unavailable=[_day(2, 5, 8), _day(4, 5, 8)],
                dispreferred=[_day(d, 0, 1) for d in WEEKDAYS], max_daily_slots=4, max_weekly_slots=12),
        Faculty(id="F06", name="Prof. Rohan Das", department="Electronics",
                courses=["EC202", "EC291"], dispreferred=[_day(5)], max_daily_slots=4, max_weekly_slots=10),
        Faculty(id="F07", name="Dr. Sana Qureshi", department="Data Science",
                courses=["DS301", "DS391", "DS303"],
                dispreferred=[_day(3)] + [_day(d, 0, 2) for d in WEEKDAYS],
                max_daily_slots=4, max_weekly_slots=12),
        Faculty(id="F08", name="Dr. Neel Banerjee", department="Mathematics (Visiting)",
                courses=["MA211", "MA201"], unavailable=[_day(1), _day(3), _day(5)],
                dispreferred=[_day(d, 0, 1) for d in (0, 2, 4)], max_daily_slots=3, max_weekly_slots=8),
    ]
    return Dataset(name="Synthetic campus (test data)", time=TimeConfig(),
                   rooms=rooms, faculty=faculty, batches=batches, courses=courses)
