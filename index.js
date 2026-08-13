import { onRequest } from "firebase-functions/v2/https";
import { createApiApp } from "./api.js";

export const api = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true,
    invoker: "public",
    maxInstances: 5,
  },
  createApiApp()
);
