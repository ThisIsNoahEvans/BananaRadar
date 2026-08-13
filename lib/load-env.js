import { existsSync, readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

// Non-secrets for local + Firebase dotenv. Keep VAPID_PRIVATE_KEY out of .env —
// it's a defineSecret, and Cloud Run rejects secret/plain env overlaps.
loadEnvFile(path.join(root, ".env"));
// Local-only secret (gitignored). Emulators also read this; production uses Secret Manager.
loadEnvFile(path.join(root, ".secret.local"));
