import express from "express";
import { searchBanana } from "./lib/starbucks.js";
import { runWatchChecks } from "./lib/check-watches.js";
import { VAPID_PUBLIC_KEY, MAX_WATCHES } from "./lib/config.js";
import {
  addWatch,
  allowWatchMutation,
  clientIp,
  deviceIdFromEndpoint,
  listWatchesForDevice,
  parsePushSubscription,
  parseStore,
  removeWatch,
  upsertDevice,
} from "./lib/watches.js";

export function createApiApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

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

  app.get(["/api/push/key", "/push/key"], (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post(["/api/watch", "/watch"], async (req, res) => {
    try {
      if (!(await allowWatchMutation(clientIp(req)))) {
        return res.status(429).json({ error: "Too many watch changes. Try later." });
      }
      const subscription = parsePushSubscription(req.body?.subscription);
      const store = parseStore(req.body?.store);
      if (!subscription) {
        return res.status(400).json({ error: "That push subscription looks invalid." });
      }
      if (!store) {
        return res.status(400).json({ error: "Pick a store to watch." });
      }
      const deviceId = await upsertDevice(subscription);
      const result = await addWatch(deviceId, store);
      const stores = await listWatchesForDevice(deviceId);
      res.json({
        ok: true,
        created: result.created,
        max: MAX_WATCHES,
        stores: publicWatches(stores),
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.message || "Could not save that watch.",
      });
    }
  });

  app.delete(["/api/watch", "/watch"], async (req, res) => {
    try {
      if (!(await allowWatchMutation(clientIp(req)))) {
        return res.status(429).json({ error: "Too many watch changes. Try later." });
      }
      const subscription = parsePushSubscription(req.body?.subscription);
      const storeNumber = String(req.body?.storeNumber || "").trim();
      if (!subscription || !storeNumber) {
        return res.status(400).json({ error: "Missing store or device." });
      }
      const deviceId = deviceIdFromEndpoint(subscription.endpoint);
      await removeWatch(deviceId, storeNumber);
      const stores = await listWatchesForDevice(deviceId);
      res.json({ ok: true, stores: publicWatches(stores) });
    } catch (err) {
      res.status(500).json({ error: err.message || "Could not remove that watch." });
    }
  });

  app.post(["/api/watches", "/watches"], async (req, res) => {
    try {
      const subscription = parsePushSubscription(req.body?.subscription);
      if (!subscription) {
        return res.status(400).json({ error: "That push subscription looks invalid." });
      }
      await upsertDevice(subscription);
      const stores = await listWatchesForDevice(
        deviceIdFromEndpoint(subscription.endpoint)
      );
      res.json({ ok: true, max: MAX_WATCHES, stores: publicWatches(stores) });
    } catch (err) {
      res.status(500).json({ error: err.message || "Could not load watches." });
    }
  });

  app.post(["/api/check-watches", "/check-watches"], async (req, res) => {
    const expected = process.env.CRON_SECRET;
    const provided = String(req.get("x-cron-secret") || "");
    if (!expected || provided !== expected) {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      const result = await runWatchChecks({
        vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message || "Watch check failed." });
    }
  });

  app.get(["/api/health", "/health"], (_req, res) => {
    res.json({ ok: true, service: "banana-radar" });
  });

  return app;
}

function publicWatches(stores) {
  return stores.map((store) => ({
    storeNumber: store.storeNumber,
    name: store.name,
    market: store.market,
    countryCode: store.countryCode,
    lastFlavourInStock: store.lastFlavourInStock ?? null,
  }));
}
