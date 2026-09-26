# Man

This repo holds two small Node apps with no build step:

- **Man** (this folder): a clean, fast chat interface for talking to Claude, with
  streamed responses, markdown rendering and a warm editorial look.
- **[ManTube](tube/)** (`tube/`): a self-hosted video site like YouTube. Upload videos
  in full original quality and watch them in a custom player, with channels, likes,
  comments, search and history. See [`tube/README.md`](tube/README.md).
- **[`ManTube.html`](ManTube.html)**: the same video site as a single file with no
  server. Double-click it to open it in your browser. Videos are saved privately in that
  browser, in full original quality.

## Man: setup

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
