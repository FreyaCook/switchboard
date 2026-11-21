import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import snowflake.connector
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(Path(__file__).parent / ".env")

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


SF_TIMEOUT = 8
PLACEHOLDER_OPERATOR_LINE = "Connecting you now, caller!"
_sf_pool = ThreadPoolExecutor(max_workers=4)


def _sf_run(sql, params):
    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        role=os.environ["SNOWFLAKE_ROLE"],
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        authenticator="SNOWFLAKE_JWT",
        private_key_file=os.environ["SNOWFLAKE_PRIVATE_KEY_FILE"],
        login_timeout=SF_TIMEOUT,
        network_timeout=SF_TIMEOUT,
    )
    try:
        cur = conn.cursor()
        try:
            cur.execute(sql, params)
            return cur.fetchall()
        finally:
            cur.close()
    finally:
        conn.close()


def sf_query(sql, params=None):
    """Run one statement; raises on any error or if it takes over SF_TIMEOUT seconds."""
    return _sf_pool.submit(_sf_run, sql, params).result(timeout=SF_TIMEOUT)


def classify_line(text):
    rows = sf_query(
        "SELECT AI_CLASSIFY(%s, ['Study','Food','Sport','Chat','Help','Random'])",
        (text,),
    )
    result = rows[0][0]
    if isinstance(result, str):
        result = json.loads(result)
    label = result["labels"][0]
    return label if label in LINE_COLOURS else "Random"


def operator_line(name_a, name_b, line):
    prompt = (
        "You are a cheerful 1950s switchboard operator. Write exactly one cheerful "
        f"sentence announcing that you are connecting {name_a} and {name_b} on the "
        f"{line} line. Use both first names and the line name. It must be a statement, "
        "not a question. Reply with only the sentence."
    )
    try:
        rows = sf_query("SELECT AI_COMPLETE('llama3.1-8b', %s)", (prompt,))
        sentence = str(rows[0][0]).strip().strip('"').strip()
    except Exception:
        return PLACEHOLDER_OPERATOR_LINE
    if not sentence or sentence.endswith("?"):
        return PLACEHOLDER_OPERATOR_LINE
    return sentence


def now() -> datetime:
    return datetime.now(timezone.utc)


def make_person(first_name, text, line, status="waiting", connection_id=None, is_fake=False):
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
        "expiresAt": None if is_fake else (joined + EXPIRY).isoformat(),
        "isFake": is_fake,
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
    created = [make_person(*s, is_fake=True) for s in seeds]
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


class LeaveRequest(BaseModel):
    personId: str


class MessageRequest(BaseModel):
    connectionId: str
    personId: str
    text: str


@app.post("/api/join")
def join(req: JoinRequest):
    snowflake_ok = True
    line = req.line
    if line is None:
        try:
            line = classify_line(req.text)
        except Exception:
            line = "Random"
            snowflake_ok = False
    if line not in LINE_COLOURS:
        raise HTTPException(400, "Unknown line")
    person = make_person(req.firstName, req.text, line, status="on_air")
    other = next(
        (
            p for p in people.values()
            if p["line"] == line and p["status"] == "on_air" and not p["isFake"]
        ),
        None,
    )
    people[person["id"]] = person
    if other:
        conn = {
            "id": str(uuid.uuid4()),
            "personIds": [other["id"], person["id"]],
            "operatorLine": operator_line(other["firstName"], person["firstName"], line),
        }
        connections[conn["id"]] = conn
        messages[conn["id"]] = []
        for p in (other, person):
            p["status"] = "connected"
            p["connectionId"] = conn["id"]
    if snowflake_ok:
        try:
            sf_query(
                "INSERT INTO SWITCHBOARD.APP.STATUSES (id, first_name, status_text, line, created_at) "
                "SELECT %s, %s, %s, %s, TO_TIMESTAMP_TZ(%s)",
                (person["id"], person["firstName"], person["text"], person["line"], person["joinedAt"]),
            )
        except Exception:
            pass
    return person


@app.post("/api/leave")
def leave(req: LeaveRequest):
    person = people.pop(req.personId, None)
    if not person:
        raise HTTPException(404, "Person not found")
    conn = connections.pop(person["connectionId"], None) if person["connectionId"] else None
    if conn:
        messages.pop(conn["id"], None)
        for pid in conn["personIds"]:
            other = people.get(pid)
            if other:
                other["status"] = "on_air"
                other["connectionId"] = None
    return {"ok": True}


@app.get("/api/board")
def board():
    current = now()
    expired = [
        pid for pid, p in people.items()
        if p["expiresAt"] and datetime.fromisoformat(p["expiresAt"]) <= current
    ]
    for pid in expired:
        del people[pid]
    for cid in [c["id"] for c in connections.values() if set(c["personIds"]) & set(expired)]:
        del connections[cid]
        messages.pop(cid, None)
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


@app.get("/api/health/snowflake")
def health_snowflake():
    try:
        sf_query("SELECT CURRENT_USER()")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e) or type(e).__name__}
