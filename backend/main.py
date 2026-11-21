import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Switchboard")

EXPIRY = timedelta(minutes=30)

LINES = [
    {"name": "Red Line", "colour": "#e63946"},
    {"name": "Blue Line", "colour": "#457b9d"},
    {"name": "Green Line", "colour": "#2a9d8f"},
    {"name": "Yellow Line", "colour": "#e9c46a"},
]
LINE_COLOURS = {line["name"]: line["colour"] for line in LINES}


def now() -> datetime:
    return datetime.now(timezone.utc)


def make_person(first_name, text, line, status="waiting", connection_id=None):
    joined = now()
    return {
        "id": str(uuid.uuid4()),
        "firstName": first_name,
        "text": text,
        "line": line,
        "colour": LINE_COLOURS[line],
        "status": status,
        "connectionId": connection_id,
        "joinedAt": joined.isoformat(),
        "expiresAt": (joined + EXPIRY).isoformat(),
    }


people: dict[str, dict] = {}
connections: dict[str, dict] = {}
messages: dict[str, list[dict]] = {}


def seed():
    seeds = [
        ("Alice", "Anyone up for a chat about books?", "Red Line"),
        ("Bram", "Looking for hiking tips.", "Blue Line"),
        ("Chloe", "Just moved to town, say hi!", "Green Line"),
        ("Dev", "Learning Rust, send help.", "Yellow Line"),
        ("Eli", "Late night thoughts.", "Red Line"),
        ("Fatima", "Favourite album this week?", "Blue Line"),
    ]
    created = [make_person(*s) for s in seeds]
    for p in created:
        people[p["id"]] = p

    for a, b in [(0, 1), (2, 3)]:
        pa, pb = created[a], created[b]
        conn = {
            "id": str(uuid.uuid4()),
            "personIds": [pa["id"], pb["id"]],
            "operatorLine": pa["line"],
        }
        connections[conn["id"]] = conn
        messages[conn["id"]] = []
        for p in (pa, pb):
            p["status"] = "connected"
            p["connectionId"] = conn["id"]


seed()


class JoinRequest(BaseModel):
    firstName: str
    text: str
    line: Optional[str] = None


class MessageRequest(BaseModel):
    connectionId: str
    personId: str
    text: str


@app.post("/api/join")
def join(req: JoinRequest):
    line = req.line or LINES[len(people) % len(LINES)]["name"]
    if line not in LINE_COLOURS:
        raise HTTPException(400, "Unknown line")
    person = make_person(req.firstName, req.text, line)
    people[person["id"]] = person
    return person


@app.get("/api/board")
def board():
    return {
        "people": list(people.values()),
        "connections": list(connections.values()),
        "lines": LINES,
    }


@app.post("/api/messages")
def post_message(req: MessageRequest):
    conn = connections.get(req.connectionId)
    if not conn:
        raise HTTPException(404, "Connection not found")
    if req.personId not in conn["personIds"]:
        raise HTTPException(403, "Person is not part of this connection")
    msg = {
        "id": str(uuid.uuid4()),
        "connectionId": req.connectionId,
        "personId": req.personId,
        "text": req.text,
        "sentAt": now().isoformat(),
    }
    messages[req.connectionId].append(msg)
    return msg


@app.get("/api/messages")
def get_messages(connectionId: str):
    if connectionId not in connections:
        raise HTTPException(404, "Connection not found")
    return messages[connectionId]
