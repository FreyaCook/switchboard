import json
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import snowflake.connector
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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
PAIRED_LINES = {"Help": "Study", "Study": "Help"}


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


SWEAR_WORDS = [
    "fuck", "shit", "bitch", "cunt", "asshole", "bastard", "dick", "slut", "whore", "nigger", "faggot",
]
SWEAR_PATTERN = re.compile(r"\b(?:" + "|".join(SWEAR_WORDS) + r")(?:s|ed|ing|er|y|head)?\b", re.IGNORECASE)


def is_offensive(first_name, text):
    combined = f"{first_name}: {text}"
    try:
        rows = sf_query(
            "SELECT AI_CLASSIFY(%s, ['appropriate', 'offensive or abusive'])",
            (combined,),
        )
        result = rows[0][0]
        if isinstance(result, str):
            result = json.loads(result)
        return result["labels"][0] == "offensive or abusive"
    except Exception:
        return bool(SWEAR_PATTERN.search(combined))


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


def make_person(first_name, text, line, status="on_air", connection_id=None, is_fake=False):
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
        ("Ben", "need a revision buddy for calculus", "Study"),
        ("Priya", "anyone done the stats essay?", "Study"),
        ("Tom", "library, 3rd floor, send coffee", "Study"),
        ("Maya", "craving ramen", "Food"),
        ("Josh", "pizza tonight, who's in?", "Food"),
        ("Sofia", "meal prep Sunday, any tips?", "Food"),
        ("Kai", "cheap eats near campus?", "Food"),
        ("Chloe", "anyone for a 5-a-side?", "Sport"),
        ("Dev", "morning run at 7?", "Sport"),
        ("Ella", "just moved in, say hi!", "Chat"),
        ("Omar", "bored in the common room", "Chat"),
        ("Eli", "how do I book a printing slot?", "Help"),
        ("Fatima", "is a hot dog a sandwich?", "Random"),
    ]
    created = [make_person(*s, is_fake=True) for s in seeds]
    for p in created:
        people[p["id"]] = p

    pairs = [
        (0, 1, "Why hello Alice and Ben, I've got you both on the Study line, so chat away, dears!"),
        (4, 5, "Well, Maya and Josh, you're through on the Food line, go right ahead, folks!"),
        (8, 9, "Chloe and Dev, how swell, I've connected you on the Sport line, have a ball!"),
        (10, 11, "Hold the phone, Ella and Omar, you're connected on the Chat line, enjoy your natter!"),
    ]
    for a, b, operator_text in pairs:
        pa, pb = created[a], created[b]
        conn = {
            "id": str(uuid.uuid4()),
            "personIds": [pa["id"], pb["id"]],
            "operatorLine": operator_text,
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
    if is_offensive(req.firstName, req.text):
        raise HTTPException(400, "The operator won't put that call through.")
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
    waiting = [p for p in people.values() if p["status"] == "on_air" and not p["isFake"]]
    other = next((p for p in waiting if p["line"] == line), None)
    if other is None and line in PAIRED_LINES:
        other = next((p for p in waiting if p["line"] == PAIRED_LINES[line]), None)
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
            print("Saved status to Snowflake")
        except Exception as e:
            print(f"Snowflake insert failed: {str(e) or type(e).__name__}")
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


@app.post("/api/demo/reset")
def demo_reset():
    people.clear()
    connections.clear()
    messages.clear()
    seed()
    return {"ok": True}


PULSE_CACHE_SECONDS = 30
_pulse_cache = {"at": None, "rows": None}


def today_rows():
    """Today's (line, count) rows from Snowflake, cached for 30s; None if Snowflake failed."""
    at = _pulse_cache["at"]
    if at is not None and time.monotonic() - at < PULSE_CACHE_SECONDS:
        return _pulse_cache["rows"]
    try:
        rows = sf_query(
            "SELECT line, COUNT(*) FROM SWITCHBOARD.APP.STATUSES "
            "WHERE created_at >= CURRENT_DATE() GROUP BY line ORDER BY COUNT(*) DESC, line"
        )
        rows = [(r[0], int(r[1])) for r in rows]
    except Exception:
        rows = None
    _pulse_cache["at"] = time.monotonic()
    _pulse_cache["rows"] = rows
    return rows


@app.get("/api/pulse")
def pulse():
    on_air = {line["name"]: 0 for line in LINES}
    for p in people.values():
        if p["line"] in on_air:
            on_air[p["line"]] += 1

    rows = today_rows()
    if rows is None:
        rows = sorted(((name, n) for name, n in on_air.items() if n), key=lambda r: (-r[1], r[0]))
    busiest = {"line": rows[0][0], "count": rows[0][1]} if rows else {"line": None, "count": 0}
    return {
        "onAirByLine": on_air,
        "busiestToday": busiest,
        "totalToday": sum(n for _, n in rows),
    }


@app.get("/api/health/snowflake")
def health_snowflake():
    try:
        sf_query("SELECT CURRENT_USER()")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e) or type(e).__name__}


app.mount(
    "/panel",
    StaticFiles(directory=Path(__file__).parent.parent / "panel", html=True),
    name="panel",
)

app.mount(
    "/",
    StaticFiles(directory=Path(__file__).parent.parent / "board" / "dist", html=True, check_dir=False),
    name="board",
)
