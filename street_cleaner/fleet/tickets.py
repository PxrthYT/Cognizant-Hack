"""Incident tickets raised by robots, and routing them to the right department.

A robot that meets a parked car on a street scheduled for cleaning reads the
plate and calls `TicketBook.raise_ticket(...)`. Low-confidence plate reads wait
for a person to confirm them; confident ones can be forwarded automatically.
Forwarding writes one JSON line per ticket to an outbox file, which stands in
for the department's email/API in this prototype.
"""
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

# Ticket kind -> department key. One place to change who receives what.
ROUTING = {
    "parked_during_cleaning": "parking",
    "suspected_abandoned": "bylaw",
    "illegal_dumping": "waste",
    "road_damage": "roads",
}

DEPARTMENTS = {
    "parking": {"name": "Parking Enforcement", "handles": "Street-cleaning parking violations"},
    "bylaw": {"name": "By-law Compliance", "handles": "Vehicles left on the street for days"},
    "waste": {"name": "Solid Waste Services", "handles": "Bulky items and illegal dumping"},
    "roads": {"name": "Road Operations", "handles": "Potholes and road damage"},
}

KIND_LABELS = {
    "parked_during_cleaning": "Parked during scheduled cleaning",
    "suspected_abandoned": "Suspected abandoned vehicle",
    "illegal_dumping": "Illegal dumping",
    "road_damage": "Road damage",
}

# Plate reads below this confidence are never forwarded without a person checking them.
REVIEW_BELOW = 0.85

OPEN_STATUSES = ("Needs review", "Ready to forward")


@dataclass
class Ticket:
    id: str
    kind: str
    street: str
    robot_id: str
    lon: float
    lat: float
    created_at: datetime
    plate: str | None = None
    plate_conf: float | None = None
    vehicle: str | None = None
    note: str = ""
    status: str = "Ready to forward"
    history: list = field(default_factory=list)  # [(datetime, text)]

    @property
    def department(self):
        return DEPARTMENTS[ROUTING[self.kind]]["name"]

    @property
    def is_open(self):
        return self.status in OPEN_STATUSES


def mask_plate(plate):
    """'FHX 123' -> 'F•• •23' for screenshots and public displays."""
    if not plate:
        return plate
    chars = list(plate)
    idx = [i for i, c in enumerate(chars) if c != " "]
    for i in idx[1:-2]:
        chars[i] = "•"
    return "".join(chars)


class TicketBook:
    def __init__(self, outbox_path=None):
        self.tickets: list[Ticket] = []
        self.outbox: list[dict] = []
        self.outbox_path = Path(outbox_path) if outbox_path else None
        self._seq = {}

    def _next_id(self, when):
        day = when.strftime("%Y%m%d")
        self._seq[day] = self._seq.get(day, 0) + 1
        return f"TKT-{day}-{self._seq[day]:03d}"

    def raise_ticket(self, kind, street, robot_id, lon, lat, when, plate=None, plate_conf=None,
                     vehicle=None, note=""):
        t = Ticket(self._next_id(when), kind, street, robot_id, lon, lat, when, plate, plate_conf, vehicle, note)
        needs_person = kind == "suspected_abandoned" or (plate is not None and (plate_conf or 0) < REVIEW_BELOW)
        t.status = "Needs review" if needs_person else "Ready to forward"
        read = f"plate {plate} ({plate_conf:.0%} confidence)" if plate else "photo"
        t.history.append((when, f"Raised by {robot_id}: {read}"))
        self.tickets.append(t)
        return t

    def plates_seen(self, plate):
        return [t for t in self.tickets if t.plate == plate]

    def confirm(self, ticket, plate, when, by="operator"):
        if plate and plate != ticket.plate:
            ticket.history.append((when, f"Plate corrected by {by}: {ticket.plate} -> {plate}"))
            ticket.plate = plate
        ticket.history.append((when, f"Confirmed by {by}"))
        ticket.status = "Ready to forward"

    def forward(self, ticket, when, by="operator"):
        msg = {
            "ticket": ticket.id,
            "to": ticket.department,
            "kind": KIND_LABELS[ticket.kind],
            "plate": ticket.plate,
            "vehicle": ticket.vehicle,
            "street": ticket.street,
            "location": [ticket.lat, ticket.lon],
            "observed_at": ticket.created_at.isoformat(timespec="minutes"),
            "robot": ticket.robot_id,
            "note": ticket.note,
            "sent_at": when.isoformat(timespec="minutes"),
        }
        self.outbox.append(msg)
        if self.outbox_path:
            self.outbox_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.outbox_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg) + "\n")
        ticket.status = "Forwarded"
        ticket.history.append((when, f"Forwarded to {ticket.department} by {by}"))

    def dismiss(self, ticket, when, reason="", by="operator"):
        ticket.status = "Dismissed"
        ticket.history.append((when, f"Dismissed by {by}" + (f": {reason}" if reason else "")))

    def close(self, ticket, when, outcome):
        ticket.status = outcome
        ticket.history.append((when, f"{ticket.department}: {outcome.lower()}"))


def ticket_to_row(t: Ticket, masked=False):
    d = asdict(t)
    d["department"] = t.department
    d["kind_label"] = KIND_LABELS[t.kind]
    if masked:
        d["plate"] = mask_plate(t.plate)
    return d
