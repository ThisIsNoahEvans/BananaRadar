import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FIRESTORE_DB } from "./config.js";

export function db() {
  const app = getApps().length ? getApp() : initializeApp();
  return getFirestore(app, FIRESTORE_DB);
}
