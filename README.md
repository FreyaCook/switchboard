# Switchboard

**The old telephone exchange, rebuilt for students.**

Go "on air" with a short status like *"stuck on recursion"* or *"craving ramen"*, and the operator connects you with another student who wants the same thing. A cord swings across the live switchboard, the operator announces your call, and a chat opens.

Built at FirstYearHack 2026 for the **Retro Remix** track and **Best Use of Snowflake**.

## How it works

1. **Go on air** with your first name and a status. Pick a line, or let the operator decide.
2. **The operator sorts you** onto a line: Study, Food, Sport, Chat, Help or Random.
3. **You're connected** to another student on the same line (Help can also connect to Study).
4. **Chat**, then leave whenever you like. You disappear automatically after 30 minutes.

## How we use Snowflake

- **`AI_CLASSIFY`** reads each status and picks the right line when a student doesn't choose one.
- **`AI_COMPLETE`** writes a fresh 1950s-style operator announcement for every connection.
- **`AI_CLASSIFY`** also screens statuses for offensive content before anyone goes on air.
- **Every status is saved** to a Snowflake table, which powers the live "Busiest today" pulse on the board.
- **Secure by design:** the app connects as its own restricted service user with key-pair authentication.
- **Graceful fallbacks:** if Snowflake is slow, the app keeps working with a default line and a ready-made operator line.

## Safety

First names only, no location, a rude-text filter, a leave button, and automatic expiry after 30 minutes.

## Tech stack

- **Back end:** Python, FastAPI
- **AI and data:** Snowflake Cortex AI functions and a Snowflake table
- **Front end:** Three.js and Vite (the switchboard), plain HTML/CSS/JavaScript (the panel), with sound effects generated using the Web Audio API
- **Built with:** JetBrains Air

The board is seeded with demo callers so it looks busy in a demo; real users are only ever matched with other real users.

## Running it locally

1. Back end: `cd backend`, create a virtual environment, `pip install -r requirements.txt`, and add a `.env` file with your Snowflake connection details (see `backend/README.md`).
2. Board: `cd board`, `npm install`, `npm run build`.
3. Start the server: `cd backend` then `uvicorn main:app --reload`, and open `http://127.0.0.1:8000/`.

## Team

Freya Cook and Nazli Muradova