import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { createApiApp } from "./api.js";
import { runAlertChecks } from "./lib/check-alerts.js";

const resendApiKey = defineSecret("RESEND_API_KEY");
const vapidPrivateKey = defineSecret("VAPID_PRIVATE_KEY");
const alertSigningKey = defineSecret("ALERT_SIGNING_KEY");

export const api = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true,
    invoker: "public",
    maxInstances: 5,
    secrets: [alertSigningKey],
  },
  createApiApp({ getSigningKey: () => alertSigningKey.value() })
);

export const checkAlerts = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 20 minutes",
    timeZone: "Europe/London",
    timeoutSeconds: 300,
    memory: "512MiB",
    maxInstances: 1,
    secrets: [resendApiKey, vapidPrivateKey, alertSigningKey],
  },
  async () => {
    await runAlertChecks({
      resendKey: resendApiKey.value(),
      vapidPrivateKey: vapidPrivateKey.value(),
      signingKey: alertSigningKey.value(),
    });
  }
);
