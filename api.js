import express from "express";
import { searchBanana } from "./lib/starbucks.js";
import { VAPID_PUBLIC_KEY } from "./lib/config.js";
import {
  allowSubscribe,
  clientIp,
  parseUnsubscribeToken,
  unsubscribeById,
  upsertSubscriber,
} from "./lib/alerts.js";

const ADDED = { ok: true, message: "Added." };
const UNSUBSCRIBE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Banana Radar</title>
    <style>
      body { font-family: Outfit, system-ui, sans-serif; background: #fff6df; color: #1e3932; display: grid; min-height: 100vh; place-items: center; margin: 0; }
      p { font-size: 1.2rem; }
    </style>
  </head>
  <body>
    <p>You're off the list.</p>
  </body>
</html>`;

export function createApiApp({
  getSigningKey = () => process.env.ALERT_SIGNING_KEY || "",
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get(["/api/search", "/search"], async (req, res) => {
    try {
      const result = await searchBanana({
        lat: req.query.lat,
        lng: req.query.lng,
        q: req.query.q,
      });
      res.set("Cache-Control", "private, max-age=30");
      res.json(result);
    } catch (err) {
      const message = err?.message || "Could not check Starbucks stock.";
      const status = /share your location|coordinates|postcode|place/i.test(message)
        ? 400
        : 502;
      res.status(status).json({ error: message });
    }
  });

  app.get(["/api/push/key", "/push/key"], (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post(["/api/alerts", "/alerts"], async (req, res) => {
    try {
      if (await allowSubscribe(clientIp(req))) {
        await upsertSubscriber({
          email: req.body?.email,
          lat: req.body?.lat,
          lng: req.body?.lng,
          label: req.body?.label,
          push: req.body?.push,
        });
      }
    } catch (err) {
      console.error("alert subscribe failed", err.message);
    }
    res.json(ADDED);
  });

  app.get(["/api/unsubscribe", "/unsubscribe"], async (req, res) => {
    try {
      const id = parseUnsubscribeToken(req.query.token, getSigningKey());
      if (id) await unsubscribeById(id);
    } catch (err) {
      console.error("unsubscribe failed", err.message);
    }
    res.set("Cache-Control", "no-store");
    res.status(200).type("html").send(UNSUBSCRIBE_HTML);
  });

  app.get(["/api/health", "/health"], (_req, res) => {
    res.json({ ok: true, service: "banana-radar" });
  });

  return app;
}
