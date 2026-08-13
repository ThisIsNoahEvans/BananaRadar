import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db.js";

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function clientIp(req) {
  return (
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.ip ||
    "unknown"
  );
}

export function locationKey(lat, lng) {
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
}

export function subscriberId(email) {
  return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

export function unsubscribeToken(id, signingKey) {
  const sig = createHmac("sha256", signingKey).update(String(id)).digest("hex");
  return `${id}.${sig}`;
}

export function parseUnsubscribeToken(token, signingKey) {
  if (!token || !signingKey) return null;
  const [id, sig] = String(token).split(".");
  if (!id || !sig) return null;
  const expected = createHmac("sha256", signingKey).update(id).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export async function allowSubscribe(ip) {
  const id = createHash("sha256").update(String(ip || "unknown")).digest("hex");
  const ref = db().collection("rateLimits").doc(id);
  const now = Date.now();
  const snap = await ref.get();
  const data = snap.data() || {};
  const windowStart = Number(data.windowStart?.toMillis?.() || 0);
  const inWindow = windowStart && now - windowStart <= RATE_WINDOW_MS;
  const count = (inWindow ? data.count || 0 : 0) + 1;
  await ref.set({
    count,
    windowStart: inWindow ? data.windowStart : new Date(now),
  });
  return count <= RATE_LIMIT;
}

export async function upsertSubscriber({ email, lat, lng, label, push } = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!EMAIL_RE.test(normalized) || normalized.length > 320) return;
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return;
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return;

  const id = subscriberId(normalized);
  const key = locationKey(parsedLat, parsedLng);
  const firestore = db();
  const ref = firestore.collection("subscribers").doc(id);
  const existing = await ref.get();
  const prev = existing.data() || {};

  await ref.set(
    {
      email: normalized,
      locationKey: key,
      lat: parsedLat,
      lng: parsedLng,
      label: String(label || "").trim().slice(0, 80),
      pushSubscriptions: mergePush(prev.pushSubscriptions, push),
      createdAt: prev.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const watchRef = firestore.collection("watches").doc(key);
  const watch = await watchRef.get();
  if (!watch.exists) {
    await watchRef.set({
      lat: parsedLat,
      lng: parsedLng,
      lastFlavourInStock: null,
      lastCheckedAt: new Date(0),
    });
  }
}

export async function unsubscribeById(id) {
  if (!id) return;
  await db().collection("subscribers").doc(id).delete();
}

export async function listWatchesToCheck(limit) {
  const snap = await db().collection("watches").orderBy("lastCheckedAt").limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function listSubscribersForLocation(key) {
  const snap = await db().collection("subscribers").where("locationKey", "==", key).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function saveWatchSnapshot(id, fields) {
  await db().collection("watches").doc(id).set(
    { ...fields, lastCheckedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

export async function markSubscriberNotified(id, pushSubscriptions) {
  const fields = { lastNotifiedAt: FieldValue.serverTimestamp() };
  if (pushSubscriptions) fields.pushSubscriptions = pushSubscriptions;
  await db().collection("subscribers").doc(id).set(fields, { merge: true });
}

function mergePush(existing, incoming) {
  const list = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const next = parsePush(incoming);
  if (!next) return list.slice(-8);
  return [...list.filter((item) => item.endpoint !== next.endpoint), next].slice(-8);
}

function parsePush(raw) {
  const endpoint = String(raw?.endpoint || "").trim();
  const p256dh = String(raw?.keys?.p256dh || "").trim();
  const auth = String(raw?.keys?.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048) return null;
  if (!p256dh || p256dh.length > 256 || !auth || auth.length > 256) return null;
  return { endpoint, keys: { p256dh, auth } };
}
