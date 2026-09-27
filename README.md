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

## Chroma Chameleon (bonus game)

`public/chameleon/index.html` is a self-contained 3D paint-and-hide game, served at
http://localhost:3000/chameleon/ (or open the file directly; it needs no server or API key).

- **Hide:** you start pure white. Sample colours and patterns from the room, paint them onto
  your body, pick a pose, then survive AI seekers. Seekers judge you by what they actually
  see: they render the room with and without you and compare the pixels, so colour mismatch,
  your shadow and movement all give you away.
- **Seek:** hunt AI chameleons that painted themselves from one viewpoint, using a paint launcher.
- Three stages (Playroom, Back Alley, Gallery), three difficulties, touch controls on phones.
- Built on three.js (loaded from a CDN). The textures, stages and sounds are all generated in the browser.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | — (required) |
| `PORT` | Port the server listens on | `3000` |
