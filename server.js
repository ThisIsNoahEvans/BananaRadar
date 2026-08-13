import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createApiApp } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;

const app = createApiApp();
app.use(express.static(path.join(__dirname, "public")));

app.listen(port, () => {
  console.log(`Banana Radar is live at http://localhost:${port}`);
});
