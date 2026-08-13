import express from "express";
import { searchBanana } from "./lib/starbucks.js";

export function createApiApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get(["/api/search/stream", "/search/stream"], async (req, res) => {
    let started = false;
    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const writeEvent = (event) => {
      if (closed) return;
      if (!started) {
        started = true;
        res.status(200);
        res.set({
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders?.();
      }
      res.write(`${JSON.stringify(event)}\n`);
      if (typeof res.flush === "function") res.flush();
    };

    try {
      await searchBanana({
        lat: req.query.lat,
        lng: req.query.lng,
        q: req.query.q,
        onProgress: writeEvent,
      });
      if (!closed) res.end();
    } catch (err) {
      const message = err?.message || "Could not check Starbucks stock.";
      if (closed) return;
      if (started) {
        writeEvent({ type: "error", error: message });
        res.end();
        return;
      }
      res.status(statusFor(message)).json({ error: message });
    }
  });

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
      res.status(statusFor(message)).json({ error: message });
    }
  });

  app.get(["/api/health", "/health"], (_req, res) => {
    res.json({ ok: true, service: "banana-radar" });
  });

  return app;
}

function statusFor(message) {
  return /share your location|coordinates|postcode|place/i.test(message)
    ? 400
    : 502;
}
