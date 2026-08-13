import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db.js";
import { MAX_WATCHES } from "./config.js";

const STORE_NUMBER_RE = /^[A-Za-z0-9-]{1,20}$/;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export function clientIp(req) {
  return (
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() || req.ip || "unknown"
  );
}

export function deviceIdFromEndpoint(endpoint) {
  return createHash("sha256").update(String(endpoint)).digest("hex");
}

export function parsePushSubscription(raw) {
  const endpoint = String(raw?.endpoint || "").trim();
  const p256dh = String(raw?.keys?.p256dh || "").trim();
  const auth = String(raw?.keys?.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048) return null;
  if (!p256dh || p256dh.length > 256 || !auth || auth.length > 256) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

export function parseStore(raw) {
  const storeNumber = String(raw?.storeNumber || "").trim();
  const name = String(raw?.name || "").trim().slice(0, 120);
  const market = String(raw?.market || "").trim().toLowerCase();
  const countryCode = String(raw?.countryCode || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const postalCode = String(raw?.postalCode || "")
    .trim()
    .slice(0, 16);
  if (!STORE_NUMBER_RE.test(storeNumber) || !name) return null;
  if (market !== "uk" && market !== "us") return null;
  return {
    storeNumber,
    name,
    market,
    countryCode: countryCode || (market === "us" ? "US" : "GB"),
    ...(postalCode ? { postalCode } : {}),
  };
}

export async function allowWatchMutation(ip) {
  const id = createHash("sha256").update(String(ip || "unknown")).digest("hex");
  const ref = db().collection("rateLimits").doc(id);
  const now = Date.now();
  const snap = await ref.get();
  const data = snap.data() || {};
  const windowStart = Number(data.windowStart?.toMillis?.() || data.windowStart || 0);
  const inWindow = windowStart && now - windowStart <= RATE_WINDOW_MS;
  const count = (inWindow ? data.count || 0 : 0) + 1;
  await ref.set({
    count,
    windowStart: inWindow ? data.windowStart : new Date(now),
  });
  return count <= RATE_LIMIT;
}

export async function upsertDevice(subscription) {
  const id = deviceIdFromEndpoint(subscription.endpoint);
  const ref = db().collection("devices").doc(id);
  const existing = await ref.get();
  await ref.set(
    {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing.exists
        ? existing.data().createdAt
        : FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return id;
}

export async function addWatch(deviceId, store) {
  const firestore = db();
  const existing = await firestore
    .collection("watches")
    .where("deviceId", "==", deviceId)
    .get();
  const already = existing.docs.find(
    (doc) => doc.data().storeNumber === store.storeNumber
  );
  if (already) {
    await already.ref.set(
      {
        name: store.name,
        market: store.market,
        countryCode: store.countryCode,
        ...(store.postalCode ? { postalCode: store.postalCode } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { id: already.id, created: false };
  }
  if (existing.size >= MAX_WATCHES) {
    const error = new Error(`You can watch up to ${MAX_WATCHES} stores on this device.`);
    error.status = 400;
    throw error;
  }
  const id = `${deviceId}_${store.storeNumber}`;
  await firestore.collection("watches").doc(id).set({
    deviceId,
    storeNumber: store.storeNumber,
    name: store.name,
    market: store.market,
    countryCode: store.countryCode,
    ...(store.postalCode ? { postalCode: store.postalCode } : {}),
    lastFlavourInStock: null,
    lastNotifiedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id, created: true };
}

export async function removeWatch(deviceId, storeNumber) {
  const id = `${deviceId}_${storeNumber}`;
  await db().collection("watches").doc(id).delete();
}

export async function listWatchesForDevice(deviceId) {
  const snap = await db()
    .collection("watches")
    .where("deviceId", "==", deviceId)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function listAllWatches() {
  const snap = await db().collection("watches").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function getDevice(deviceId) {
  const snap = await db().collection("devices").doc(deviceId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function saveWatchSnapshot(id, fields) {
  await db().collection("watches").doc(id).set(
    {
      ...fields,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function markWatchNotified(id) {
  await db().collection("watches").doc(id).update({
    lastNotifiedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteDeviceAndWatches(deviceId) {
  const firestore = db();
  const watches = await firestore
    .collection("watches")
    .where("deviceId", "==", deviceId)
    .get();
  const batch = firestore.batch();
  for (const doc of watches.docs) batch.delete(doc.ref);
  batch.delete(firestore.collection("devices").doc(deviceId));
  await batch.commit();
}
