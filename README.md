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

## Hollowmere Fields (bonus game)

`public/fields.html` is a small top-down adventure game in a single file. With the
server running, open http://localhost:3000/fields.html (or open the file directly
in a browser). Walk the fields, tame and ride wild horses, fight slimes, wolves,
goblins and bandits, and take down the ogre in the Old Ruin. Works with keyboard
and mouse, or touch controls on phones.
