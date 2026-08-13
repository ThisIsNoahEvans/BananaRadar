import "./lib/load-env.js";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createApiApp } from "./api.js";
import { runWatchChecks } from "./lib/check-watches.js";

const vapidPrivateKey = defineSecret("VAPID_PRIVATE_KEY");

export const api = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true,
    invoker: "public",
    maxInstances: 5,
    secrets: [vapidPrivateKey],
  },
  createApiApp()
);

export const checkWatches = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 15 minutes",
    timeZone: "Europe/London",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [vapidPrivateKey],
  },
  async () => {
    await runWatchChecks({ vapidPrivateKey: vapidPrivateKey.value() });
  }
);
