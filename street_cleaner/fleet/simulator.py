"""Simulated street-cleaning fleet for the dashboard.

Depots hold robots; each robot owns 2-4 nearby streets. During the cleaning
shift a robot drives to its next street, cleans it end to end, and goes home
to charge or empty its bin. Parked cars on a scheduled street become tickets.
Health (battery, brush, camera, motor) wears down as robots work.

Everything is deterministic for a given seed, so a demo looks the same each run.
"""
import json
import math
import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path

from .layout import STATIONS
from .tickets import ROUTING, TicketBook

GEOM_PATH = Path(__file__).with_name("streets_osm.json")

SHIFT_START, SHIFT_END = 7, 15          # cleaning hours
TRAVEL_SPEED = 1.4                      # m/s between depot and streets
CHARGE_MINUTES = 40                     # empty to full
BATTERY_PER_M = 100 / 3000              # % per metre cleaned (healthy battery)
BATTERY_PER_S_TRAVEL = 0.004
BIN_CAPACITY_KG = 12.0
DUMPING_EVERY_M = 9000                  # how often a robot finds dumped bulky items
POTHOLE_EVERY_M = 12000

OUTCOMES = {"parking": "Citation issued", "bylaw": "Case opened",
            "waste": "Pickup scheduled", "roads": "Repair scheduled"}
CLOSED_STATUSES = set(OUTCOMES.values()) | {"Dismissed"}

COLORS = ["Grey", "Black", "White", "Silver", "Blue", "Red", "Green"]
BODIES = ["sedan", "SUV", "hatchback", "pickup", "minivan"]
PLATE_LETTERS = "ABCDEFGHJKLMNPRSTVWXYZ"


def dist(a, b):
    dx = (b[0] - a[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (b[1] - a[1]) * 111320
    return math.hypot(dx, dy)


def convex_hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


class Street:
    def __init__(self, name, pieces, robot_id, station_id):
        self.name = name
        self.pieces = [[tuple(p) for p in piece] for piece in pieces]
        self.cum = []           # cumulative distance at each point, per piece
        d = 0.0
        for piece in self.pieces:
            c = [d]
            for a, b in zip(piece, piece[1:]):
                d += dist(a, b)
                c.append(d)
            self.cum.append(c)
        self.length = d
        self.robot_id = robot_id
        self.station_id = station_id
        self.scheduled_today = True
        self.next_date: date | None = None
        self.last_cleaned: datetime | None = None
        self.progress = 0.0
        self.dirt = 1.0
        self.started_at: datetime | None = None
        self.done_at: datetime | None = None
        self.blocked = []       # [(metres along street, plate, ticket id)]

    @property
    def done(self):
        return self.progress >= self.length - 0.01

    def point_at(self, d):
        d = max(0.0, min(d, self.length))
        for piece, cum in zip(self.pieces, self.cum):
            if d <= cum[-1]:
                for i in range(len(cum) - 1):
                    if cum[i] <= d <= cum[i + 1]:
                        span = cum[i + 1] - cum[i]
                        f = 0 if span == 0 else (d - cum[i]) / span
                        a, b = piece[i], piece[i + 1]
                        return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        return self.pieces[-1][-1]

    def split(self, d):
        """(cleaned paths, remaining paths) at d metres along the street."""
        done, todo = [], []
        for piece, cum in zip(self.pieces, self.cum):
            if cum[-1] <= d:
                done.append(piece)
            elif cum[0] >= d:
                todo.append(piece)
            else:
                i = max(k for k in range(len(cum)) if cum[k] <= d)
                p = self.point_at(d)
                done.append(piece[: i + 1] + [p])
                todo.append([p] + piece[i + 1:])
        return done, todo


@dataclass
class Station:
    id: str
    name: str
    pos: tuple
    robot_ids: list


@dataclass
class Robot:
    id: str
    station_id: str
    queue: list                       # street names in cleaning order
    dock: tuple
    pos: tuple
    speed: float = 0.14               # m/s while cleaning
    state: str = "docked"             # docked | charging | travelling | cleaning | returning | maintenance
    battery: float = 100.0
    battery_capacity: float = 96.0    # % of original capacity
    brush_wear: float = 20.0
    camera_clean: float = 95.0
    motor_temp: float = 22.0
    bin_kg: float = 0.0
    odometer_km: float = 0.0
    last_service: date | None = None
    faults: list = field(default_factory=list)   # [{"severity", "text"}]
    current: str | None = None
    target: tuple | None = None
    return_reason: str = ""
    to_maintenance: bool = False
    note: str = ""
    debris_today: float = 0.0
    metres_today: float = 0.0
    streets_done_today: int = 0


def robot_issues(r: Robot, today: date):
    """[(severity, text)] with severity in critical | serious | warning."""
    out = [(f["severity"], f["text"]) for f in r.faults]
    if r.brush_wear >= 90:
        out.append(("critical", f"Main brush {r.brush_wear:.0f}% worn - replace"))
    elif r.brush_wear >= 75:
        out.append(("warning", f"Main brush {r.brush_wear:.0f}% worn - replace this week"))
    if r.battery_capacity < 80:
        out.append(("serious", f"Battery holds {r.battery_capacity:.0f}% of original charge - replace"))
    if r.camera_clean < 65:
        out.append(("serious", f"Camera lens dirty ({r.camera_clean:.0f}% clear) - plate reads unreliable"))
    elif r.camera_clean < 80:
        out.append(("warning", f"Camera lens {r.camera_clean:.0f}% clear - clean at next dock"))
    if r.motor_temp >= 80:
        out.append(("critical", f"Brush motor {r.motor_temp:.0f} °C"))
    elif r.motor_temp >= 65:
        out.append(("warning", f"Brush motor running warm ({r.motor_temp:.0f} °C)"))
    if r.battery < 20 and r.state not in ("charging", "docked", "maintenance"):
        out.append(("warning", f"Battery low ({r.battery:.0f}%)"))
    if r.last_service and (today - r.last_service).days > 30:
        out.append(("warning", f"Service overdue ({(today - r.last_service).days} days)"))
    order = {"critical": 0, "serious": 1, "warning": 2}
    return sorted(out, key=lambda x: order[x[0]])


def health_score(r: Robot):
    s = 100.0
    s -= max(0, 90 - r.battery_capacity) * 1.0
    s -= max(0, r.brush_wear - 60) * 0.8
    s -= max(0, 85 - r.camera_clean) * 0.6
    s -= max(0, r.motor_temp - 60) * 1.5
    for f in r.faults:
        s -= 40 if f["severity"] == "critical" else 12
    return max(0, min(100, round(s)))


class FleetSim:
    def __init__(self, seed=7, today: date | None = None, warmup_hours=2.5, outbox_path=None):
        self.rng = random.Random(seed)
        self.today = today or date.today()
        self.clock = datetime.combine(self.today, time(SHIFT_START))
        self.auto_forward = True
        self.book = TicketBook()
        self.events = []
        self.vehicles = []
        self.acks = []                 # [(due, ticket, outcome)]
        self.metres_to_dumping = self.rng.uniform(0.3, 1) * DUMPING_EVERY_M
        self.metres_to_pothole = self.rng.uniform(0.3, 1) * POTHOLE_EVERY_M

        geom = json.loads(GEOM_PATH.read_text(encoding="utf-8"))
        self.attribution = geom["attribution"]
        self.stations, self.robots, self.streets = {}, {}, {}
        for st in STATIONS:
            depot = tuple(geom["depots"][st["id"]])
            self.stations[st["id"]] = Station(st["id"], st["name"], depot, list(st["robots"]))
            for i, (rid, names) in enumerate(st["robots"].items()):
                dock = (depot[0] + (i - 1) * 0.00018, depot[1] - 0.00008)
                self.robots[rid] = Robot(rid, st["id"], list(names), dock, dock,
                                         speed=self.rng.uniform(0.12, 0.16))
                for n in names:
                    self.streets[n] = Street(n, geom["streets"][n]["pieces"], rid, st["id"])

        self._seed_robots()
        self._seed_schedule()
        self._seed_history()
        self._seed_vehicles()
        warm_end = self.clock + timedelta(hours=warmup_hours)
        self.scripted = [(warm_end + timedelta(minutes=35), "SC-07",
                          {"severity": "critical", "text": "Main brush motor over-current"})]
        self.step(warmup_hours * 3600)
        self.book.outbox_path = Path(outbox_path) if outbox_path else None

    # ------------------------------------------------------------------ seeding
    def _seed_robots(self):
        r = self.robots
        for rob in r.values():
            rob.battery_capacity = self.rng.uniform(90, 98)
            rob.brush_wear = self.rng.uniform(15, 50)
            rob.camera_clean = self.rng.uniform(88, 98)
            rob.last_service = self.today - timedelta(days=self.rng.randint(4, 24))
            rob.odometer_km = self.rng.uniform(180, 900)
        r["SC-02"].camera_clean = 64
        r["SC-03"].battery_capacity = 74
        r["SC-03"].last_service = self.today - timedelta(days=37)
        r["SC-04"].note = "Prototype unit (camera + vacuum on RC base)"
        r["SC-04"].brush_wear, r["SC-04"].camera_clean = 8, 97
        r["SC-05"].brush_wear = 81
        r["SC-08"].state = "maintenance"
        r["SC-08"].brush_wear = 96
        r["SC-08"].faults = [{"severity": "critical", "text": "Left drive wheel encoder not responding"}]
        self._event("SC-08", "Held at depot: left drive wheel encoder not responding", "critical")

    def _seed_schedule(self):
        force = set(self.robots["SC-04"].queue) | set(self.robots["SC-08"].queue)
        for s in self.streets.values():
            s.dirt = self.rng.uniform(0.6, 2.0)
            s.scheduled_today = s.name in force or self.rng.random() < 0.8
            if s.scheduled_today:
                s.last_cleaned = datetime.combine(self.today - timedelta(days=7), time(self.rng.randint(8, 13)))
            else:
                s.next_date = self.today + timedelta(days=self.rng.randint(1, 6))
                s.last_cleaned = datetime.combine(self.today - timedelta(days=7 - (s.next_date - self.today).days),
                                                  time(self.rng.randint(8, 13), self.rng.randint(0, 59)))
        self.streets["Spring Garden Road"].dirt = 2.6

    def _plate(self):
        return "".join(self.rng.choice(PLATE_LETTERS) for _ in range(3)) + f" {self.rng.randint(0, 999):03d}"

    def _vehicle_desc(self):
        return f"{self.rng.choice(COLORS)} {self.rng.choice(BODIES)}"

    def _seed_vehicles(self):
        for s in self.streets.values():
            if not s.scheduled_today or s.length < 60:
                continue
            n = self.rng.choices([0, 1, 2], weights=[55, 35, 10])[0]
            for _ in range(n):
                self.vehicles.append({"street": s.name, "at": self.rng.uniform(20, s.length - 20),
                                      "plate": self._plate(), "conf": self.rng.uniform(0.86, 0.99),
                                      "vehicle": self._vehicle_desc(), "kind": "parked_during_cleaning",
                                      "ticket": None})
        # one car that has not moved for days, one repeat offender: both have earlier tickets
        abandoned = self._vehicle_on("Carlton Street")
        abandoned["kind"] = "suspected_abandoned"
        repeat = self._vehicle_on("College Street")
        for days in (6, 4, 2):
            self._past_ticket(abandoned["street"], days, abandoned["plate"], abandoned["vehicle"], "Citation issued")
        for days, street in ((5, "Summer Street"), (3, "Morris Street")):
            self._past_ticket(street, days, repeat["plate"], repeat["vehicle"], "Citation issued")

    def _vehicle_on(self, street):
        s = self.streets[street]
        s.scheduled_today = True
        s.next_date = None
        for v in self.vehicles:
            if v["street"] == street:
                return v
        v = {"street": street, "at": s.length * 0.6, "plate": self._plate(), "conf": 0.93,
             "vehicle": self._vehicle_desc(), "kind": "parked_during_cleaning", "ticket": None}
        self.vehicles.append(v)
        return v

    def _past_ticket(self, street, days_ago, plate=None, vehicle=None, outcome=None):
        s = self.streets[street]
        when = datetime.combine(self.today - timedelta(days=days_ago),
                                time(self.rng.randint(7, 13), self.rng.randint(0, 59)))
        lon, lat = s.point_at(self.rng.uniform(0, s.length))
        t = self.book.raise_ticket("parked_during_cleaning", street, s.robot_id, lon, lat, when,
                                   plate or self._plate(), self.rng.uniform(0.86, 0.99),
                                   vehicle or self._vehicle_desc())
        outcome = outcome or self.rng.choices(["Citation issued", "Dismissed"], weights=[85, 15])[0]
        t.status = "Forwarded"
        t.history.append((when + timedelta(minutes=1), "Forwarded to Parking Enforcement by auto"))
        later = when + timedelta(minutes=self.rng.randint(15, 60))
        if outcome == "Dismissed":
            self.book.dismiss(t, later, "resident permit on file", by="Parking Enforcement")
        else:
            self.book.close(t, later, outcome)

    def _seed_history(self):
        self.history = []
        for days in range(6, 0, -1):
            d = self.today - timedelta(days=days)
            if d.weekday() >= 5:
                self.history.append({"date": d, "streets_cleaned": 0, "debris_kg": 0.0, "tickets": 0})
                continue
            n_t = self.rng.randint(2, 5)
            streets = self.rng.sample(sorted(self.streets), n_t)
            for s in streets:
                self._past_ticket(s, days)
            self.history.append({"date": d, "streets_cleaned": self.rng.randint(22, 29),
                                 "debris_kg": round(self.rng.uniform(55, 95), 1), "tickets": n_t})

    # ------------------------------------------------------------------ helpers
    def _event(self, robot_id, text, severity="info"):
        self.events.append({"time": self.clock, "robot": robot_id, "text": text, "severity": severity})
        del self.events[:-300]

    def next_street(self, r: Robot):
        for n in r.queue:
            s = self.streets[n]
            if s.robot_id == r.id and s.scheduled_today and not s.done:
                return s
        return None

    def _move(self, r: Robot, target, metres):
        d = dist(r.pos, target)
        if d <= metres:
            r.pos = target
            return True
        f = metres / d
        r.pos = (r.pos[0] + (target[0] - r.pos[0]) * f, r.pos[1] + (target[1] - r.pos[1]) * f)
        return False

    def _send_home(self, r: Robot, reason):
        r.state, r.return_reason, r.current = "returning", reason, None
        self._event(r.id, f"Heading back to depot: {reason}",
                    "warning" if reason not in ("Zone finished", "Shift over") else "info")

    def _in_shift(self):
        return SHIFT_START <= self.clock.hour < SHIFT_END

    def _critical(self, r):
        return any(f["severity"] == "critical" for f in r.faults)

    # ------------------------------------------------------------------ simulation
    def step(self, seconds):
        remaining = seconds
        while remaining > 0:
            dt = min(2.0, remaining)
            remaining -= dt
            self.clock += timedelta(seconds=dt)
            for when, rid, fault in list(self.scripted):
                if self.clock >= when:
                    self.scripted.remove((when, rid, fault))
                    self.robots[rid].faults.append(fault)
                    self.robots[rid].motor_temp = max(self.robots[rid].motor_temp, 82)
                    self._event(rid, fault["text"], "critical")
            for r in self.robots.values():
                self._tick_robot(r, dt)
            self._tick_tickets()

    def _tick_robot(self, r: Robot, dt):
        hot = any("motor" in f["text"] for f in r.faults)
        target_temp = 88 if hot and r.state == "cleaning" else (48 if r.state == "cleaning" else 22)
        r.motor_temp += (target_temp - r.motor_temp) * min(1, 0.004 * dt)

        if r.state == "maintenance":
            return
        if r.state in ("charging", "docked"):
            if r.battery < 100:
                r.battery = min(100.0, r.battery + dt * 100 / (CHARGE_MINUTES * 60))
                r.state = "charging" if r.battery < 99.5 else "docked"
            nxt = self.next_street(r)
            if nxt and self._in_shift() and r.battery >= 90 and not self._critical(r):
                r.current, r.target, r.state = nxt.name, nxt.point_at(nxt.progress), "travelling"
                self._event(r.id, f"Left depot for {nxt.name}")
            return
        if r.state in ("travelling", "returning"):
            r.battery -= BATTERY_PER_S_TRAVEL * dt
            if r.state == "travelling" and self._critical(r):
                self._send_home(r, r.faults[-1]["text"])
                return
            target = r.target if r.state == "travelling" else r.dock
            if self._move(r, target, TRAVEL_SPEED * dt):
                if r.state == "travelling":
                    r.state = "cleaning"
                    s = self.streets[r.current]
                    s.started_at = s.started_at or self.clock
                    self._event(r.id, f"{'Resumed' if s.progress > 0 else 'Started'} {s.name}")
                else:
                    if r.bin_kg > 0.5:
                        self._event(r.id, f"Emptied {r.bin_kg:.1f} kg at depot")
                    r.bin_kg = 0
                    if self._critical(r) or r.to_maintenance:
                        r.state, r.to_maintenance = "maintenance", False
                        self._event(r.id, "In maintenance bay", "serious")
                    else:
                        r.state = "charging"
            return

        # cleaning
        s = self.streets[r.current]
        old = s.progress
        new = min(s.length, old + r.speed * dt)
        for v in self.vehicles:
            if v["street"] == s.name and v["ticket"] is None and old < v["at"] <= new:
                self._detect_vehicle(r, s, v)
        m = new - old
        s.progress = new
        r.pos = s.point_at(new)
        kg = m * 0.0035 * s.dirt * self.rng.uniform(0.5, 1.5)
        r.bin_kg += kg
        r.debris_today += kg
        r.metres_today += m
        r.odometer_km += m / 1000
        r.battery -= m * BATTERY_PER_M * 100 / r.battery_capacity
        r.brush_wear = min(100, r.brush_wear + m * 0.0004)
        r.camera_clean = max(0, r.camera_clean - m * 0.0006)
        self._street_issues(r, s, m)

        if s.done:
            s.done_at = s.last_cleaned = self.clock
            r.streets_done_today += 1
            self._event(r.id, f"Finished {s.name}", "good")
            nxt = self.next_street(r)
            if nxt and self._in_shift() and r.battery > 25 and r.bin_kg < BIN_CAPACITY_KG * 0.75:
                r.current, r.target, r.state = nxt.name, nxt.point_at(nxt.progress), "travelling"
            else:
                self._send_home(r, "Zone finished" if not nxt else "Shift over" if not self._in_shift()
                                else "Low battery" if r.battery <= 25 else "Bin full")
        elif self._critical(r):
            self._send_home(r, r.faults[-1]["text"])
        elif r.battery < 18:
            self._send_home(r, "Low battery")
        elif r.bin_kg >= BIN_CAPACITY_KG * 0.92:
            self._send_home(r, "Bin full")
        elif r.to_maintenance:
            self._send_home(r, "Called in for maintenance")
        elif not self._in_shift():
            self._send_home(r, "Shift over")

    def _detect_vehicle(self, r: Robot, s: Street, v):
        conf = v["conf"] * (0.7 + 0.3 * r.camera_clean / 100)
        lon, lat = s.point_at(v["at"])
        seen = self.book.plates_seen(v["plate"])
        note = ""
        if v["kind"] == "suspected_abandoned":
            note = f"Same spot on {len(seen)} earlier checks since {min(t.created_at for t in seen):%d %b}"
        elif seen:
            note = f"Ticket #{len(seen) + 1} for this plate in 7 days"
        t = self.book.raise_ticket(v["kind"], s.name, r.id, lon, lat, self.clock, v["plate"], conf, v["vehicle"], note)
        v["ticket"] = t.id
        s.blocked.append((v["at"], v["plate"], t.id))
        self._event(r.id, f"{v['vehicle']} parked on {s.name}, plate read {conf:.0%} sure - {t.id}; cleaned around it",
                    "warning")

    def _street_issues(self, r: Robot, s: Street, metres):
        self.metres_to_dumping -= metres
        self.metres_to_pothole -= metres
        lon, lat = r.pos
        if self.metres_to_dumping <= 0:
            self.metres_to_dumping = self.rng.uniform(0.5, 1.5) * DUMPING_EVERY_M
            item = self.rng.choice(["Mattress", "Old sofa", "Bags of construction waste", "Broken TV"])
            t = self.book.raise_ticket("illegal_dumping", s.name, r.id, lon, lat, self.clock, note=f"{item} on the curb")
            self._event(r.id, f"{item} dumped on {s.name} - {t.id}", "warning")
        if self.metres_to_pothole <= 0:
            self.metres_to_pothole = self.rng.uniform(0.5, 1.5) * POTHOLE_EVERY_M
            t = self.book.raise_ticket("road_damage", s.name, r.id, lon, lat, self.clock,
                                       note=f"Pothole about {self.rng.randint(25, 60)} cm wide by the curb")
            self._event(r.id, f"Pothole on {s.name} - {t.id}", "warning")

    def _tick_tickets(self):
        if self.auto_forward:
            for t in self.book.tickets:
                if t.status == "Ready to forward" and t.created_at.date() == self.today:
                    self.forward(t, by="auto")
        for item in list(self.acks):
            due, t, outcome = item
            if self.clock >= due:
                self.acks.remove(item)
                if t.status == "Forwarded":
                    self.book.close(t, self.clock, outcome)

    # ------------------------------------------------------------------ operator actions
    def forward(self, t, by="operator"):
        self.book.forward(t, self.clock, by)
        due = self.clock + timedelta(minutes=self.rng.randint(10, 45))
        self.acks.append((due, t, OUTCOMES[ROUTING[t.kind]]))

    def confirm(self, t, plate):
        self.book.confirm(t, plate.strip().upper(), self.clock)

    def dismiss(self, t, reason=""):
        self.book.dismiss(t, self.clock, reason)

    def service(self, rid):
        r = self.robots[rid]
        r.faults, r.brush_wear, r.camera_clean, r.motor_temp = [], 3.0, 100.0, 22.0
        if r.battery_capacity < 80:
            r.battery_capacity = 100.0
        r.last_service = self.today
        if r.state == "maintenance":
            r.state = "charging"
        self._event(rid, "Serviced and back in service", "good")

    def call_in(self, rid):
        r = self.robots[rid]
        if r.state in ("charging", "docked"):
            r.state = "maintenance"
            self._event(rid, "In maintenance bay", "serious")
        else:
            r.to_maintenance = True
            if r.state == "travelling":
                self._send_home(r, "Called in for maintenance")

    def reassign(self, from_id, to_id):
        moved = []
        for n in self.robots[from_id].queue:
            s = self.streets[n]
            if s.robot_id == from_id and s.scheduled_today and not s.done:
                s.robot_id = to_id
                if n not in self.robots[to_id].queue:
                    self.robots[to_id].queue.append(n)
                moved.append(n)
        if moved:
            self._event(to_id, f"Took over {', '.join(moved)} from {from_id}")
        return moved

    # ------------------------------------------------------------------ read-outs
    def street_status(self, s: Street):
        if not s.scheduled_today:
            return "Not scheduled today"
        if s.done:
            return "Cleaned"
        owner = self.robots[s.robot_id]
        if owner.state == "cleaning" and owner.current == s.name:
            return "Cleaning now"
        if owner.state == "maintenance" or self._critical(owner):
            return "Waiting - robot down"
        return "Partly cleaned" if s.progress > 0 else "To clean"

    def zone_polygon(self, rid, pad_m=30):
        pts = [p for n in self.robots[rid].queue if self.streets[n].robot_id == rid
               for piece in self.streets[n].pieces for p in piece]
        if not pts:
            return []
        hull = convex_hull(pts)
        cx = sum(p[0] for p in hull) / len(hull)
        cy = sum(p[1] for p in hull) / len(hull)
        out = []
        for p in hull:
            d = dist(p, (cx, cy)) or 1
            f = 1 + pad_m / d
            out.append((cx + (p[0] - cx) * f, cy + (p[1] - cy) * f))
        return out

    def today_stats(self):
        sched = [s for s in self.streets.values() if s.scheduled_today]
        today_tix = [t for t in self.book.tickets if t.created_at.date() == self.today]
        return {
            "streets_scheduled": len(sched),
            "streets_cleaned": sum(s.done for s in sched),
            "debris_kg": sum(r.debris_today for r in self.robots.values()),
            "km": sum(r.metres_today for r in self.robots.values()) / 1000,
            "tickets_today": len(today_tix),
        }
