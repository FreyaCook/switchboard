# Switchboard backend

FastAPI app with in-memory storage (resets on restart).

## Build the board

The board must be built before the backend can serve it at `/`:

```sh
cd board
npm install
npm run build
```

## Run

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Server runs at http://127.0.0.1:8000 (interactive docs at `/docs`).

## Endpoints

- `POST /api/join` — body: `{"firstName", "text", "line"?}`
- `GET /api/board` — `{people, connections, lines}`
- `POST /api/messages` — body: `{"connectionId", "personId", "text"}`
- `GET /api/messages?connectionId=...`
