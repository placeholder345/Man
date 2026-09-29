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

## Meadowlight

`public/field.html` is a small walking game: an endless field of wind-blown grass
with a day and night cycle, synthesised birdsong and crickets, and seven wildflower
species to find for your field journal. With the server running, open
http://localhost:3000/field.html, or open the file directly in a browser.
It is a single self-contained page (three.js loads from cdnjs).

Controls: WASD or arrow keys to walk, Shift to run, mouse to look, E to pick a
flower, J for the journal, 1–4 to jump between dawn, noon, golden hour and night.
On a phone, the left thumb walks and the right thumb looks around.

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
