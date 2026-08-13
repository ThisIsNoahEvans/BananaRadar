import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { searchBanana } from "./lib/starbucks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/search", async (req, res) => {
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "banana-radar" });
});

app.listen(port, () => {
  console.log(`Banana Radar is live at http://localhost:${port}`);
});
