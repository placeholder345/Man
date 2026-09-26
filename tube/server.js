import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/app.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

if (fs.existsSync(path.join(ROOT, ".env"))) {
  process.loadEnvFile(path.join(ROOT, ".env"));
}

const PORT = Number(process.env.PORT) || 4000;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
const MAX_UPLOAD_MB = Math.max(0, Number(process.env.MAX_UPLOAD_MB) || 0);

const { app } = createApp({ dataDir: DATA_DIR, maxUploadBytes: MAX_UPLOAD_MB * 1024 * 1024 });

const server = app.listen(PORT, () => {
  console.log(`\n  ManTube is running\n`);
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) console.log(`  Network:  http://${net.address}:${PORT}`);
    }
  }
  console.log(`\n  Videos are stored in ${DATA_DIR}`);
  console.log(`  Upload size limit: ${MAX_UPLOAD_MB ? `${MAX_UPLOAD_MB} MB` : "none"}\n`);
});

// Big uploads over slow connections can take hours; Node's default 5-minute
// request timeout would cut them off.
server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT in .env to use another one.`);
    process.exit(1);
  }
  throw err;
});
