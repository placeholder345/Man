# Man

A clean, fast chat interface for talking to Claude — streamed responses, markdown
rendering, and a warm editorial look, in a single small Node app with no build step.

## Setup

```bash
npm install
cp .env.example .env   # then add your Anthropic API key
npm start
```

Open http://localhost:3000.

## How it works

- `server.js` — an Express server with one route, `POST /api/chat`, that streams
  Claude's response back to the browser over Server-Sent Events.
- `public/` — the frontend: plain HTML/CSS/JS, no framework or bundler.
- Model: `claude-opus-5` with adaptive thinking enabled, so it reasons more on
  harder questions without any extra configuration.

The full conversation history is kept in the browser and re-sent with each
message, per how the Claude API is designed to be used (it's stateless).

## The Doctors (mini game)

`public/the-doctors/index.html` is a small point-and-click game, self-contained in one
file with no dependencies. You wake up to a text from the surgery, drive over with Teddy
in the back seat, check in, wait two minutes, have a blood test, drive home and use the
bathroom.

- With the server running, open http://localhost:3000/the-doctors/
- Or open the file directly in a browser; it doesn't need the server.

Controls: ← → (or tap the floor) to walk, E to use things, Space to continue dialogue.
When driving, → accelerates and ← brakes. There are on-screen buttons for touch screens.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | — (required) |
| `PORT` | Port the server listens on | `3000` |
