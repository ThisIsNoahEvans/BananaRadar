import express from "express";
import { searchBanana } from "./lib/starbucks.js";

export function createApiApp() {
  const app = express();
  app.disable("x-powered-by");

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
      const status = /share your location|coordinates|postcode|place/i.test(
        message
      )
        ? 400
        : 502;
      res.status(status).json({ error: message });
    }
  });

  app.get(["/api/health", "/health"], (_req, res) => {
    res.json({ ok: true, service: "banana-radar" });
  });

  return app;
}
