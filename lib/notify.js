import webpush from "web-push";
import { SITE_URL, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "./config.js";

export async function sendStorePush({
  subscription,
  storeName,
  vapidPrivateKey,
  url,
}) {
  const key = vapidPrivateKey || process.env.VAPID_PRIVATE_KEY;
  if (!key || key === "unset") {
    throw new Error("VAPID private key is not configured.");
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, key);
  const title = `Banana's on at ${storeName}`;
  const body = "The flavour is back on that store's menu.";
  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title,
      body,
      url: url || SITE_URL,
    })
  );
  return { title, body };
}
