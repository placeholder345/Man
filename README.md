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

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | — (required) |
| `PORT` | Port the server listens on | `3000` |

## Meadowlight

A small first-person walking game lives at `/meadowlight/` (served from `public/meadowlight/index.html`
when you run the app, or just open the file in a browser). It is a single file: Three.js from a CDN,
GPU-instanced grass, a day and night cycle, and twelve lost lights to find. WASD to walk, Shift to run,
Space to jump, mouse to look, Esc to pause. Touch controls appear on phones.
