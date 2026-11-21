import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Switchboard")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

EXPIRY = timedelta(minutes=30)

LINES = [
    {"name": "Study", "colour": "#3b82f6"},
    {"name": "Food", "colour": "#ff7a00"},
    {"name": "Sport", "colour": "#22d34f"},
    {"name": "Chat", "colour": "#ff3da5"},
    {"name": "Help", "colour": "#ff2d2d"},
    {"name": "Random", "colour": "#a855f7"},
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
        ("Alice", "stuck on recursion", "Study"),
        ("Bram", "craving ramen", "Food"),
        ("Chloe", "anyone for a 5-a-side?", "Sport"),
        ("Dev", "just moved in, say hi!", "Chat"),
        ("Eli", "how do I book a printing slot?", "Help"),
        ("Fatima", "is a hot dog a sandwich?", "Random"),
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
    current = now()
    for pid in [
        pid for pid, p in people.items()
        if datetime.fromisoformat(p["expiresAt"]) <= current
    ]:
        del people[pid]
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
