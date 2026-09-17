import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (fs.existsSync(path.join(__dirname, ".env"))) {
  process.loadEnvFile(path.join(__dirname, ".env"));
}
const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You are Man, a sharp, warm, and genuinely helpful AI assistant.
Answer directly and clearly. Use markdown (headings, lists, code blocks) when it
actually improves readability, not by default. Be concise for simple questions and
thorough for complex ones. If you don't know something, say so plainly.`;

const client = new Anthropic();
const app = express();

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return res.status(400).json({ error: "each message needs role 'user'|'assistant' and string content" });
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      messages,
    });

    stream.on("text", (delta) => send("delta", { text: delta }));

    const finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason === "refusal") {
      send("error", { message: "The response was declined for safety reasons." });
    } else {
      send("done", { stop_reason: finalMessage.stop_reason });
    }
  } catch (err) {
    console.error(err);
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "Invalid Anthropic API key on the server."
        : err instanceof Anthropic.RateLimitError
        ? "Rate limited by the Claude API — try again shortly."
        : err instanceof Anthropic.APIError
        ? `Claude API error: ${err.message}`
        : err instanceof Anthropic.AnthropicError
        ? "The server has no Anthropic API key configured. Set ANTHROPIC_API_KEY in .env and restart."
        : "Unexpected server error.";
    send("error", { message });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Man is listening on http://localhost:${PORT}`);
});
