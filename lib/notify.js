import webpush from "web-push";
import { SITE_URL, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "./config.js";

export async function notifyAlert({
  alert,
  stores,
  resendKey,
  vapidPrivateKey,
  unsubscribeUrl,
}) {
  const names = (stores || [])
    .filter((store) => store.flavourInStock)
    .slice(0, 3)
    .map((store) => store.name)
    .join(", ");
  const label = alert.label || "your area";
  const body = names
    ? `Banana flavour is in at ${names}.`
    : `Banana flavour is back near ${label}.`;
  const gone = [];

  if (resendKey?.startsWith("re_") && alert.email) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL || "Banana Radar <onboarding@resend.dev>",
          to: [alert.email],
          subject: "Banana flavour is back nearby",
          html: `<p>${escapeHtml(body)}</p><p><a href="${SITE_URL}">Open Banana Radar</a></p><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`,
        }),
      });
      if (!response.ok) console.error("email failed", response.status);
    } catch (err) {
      console.error("email failed", err.message);
    }
  }

  const key = vapidPrivateKey || process.env.VAPID_PRIVATE_KEY;
  if (key && key !== "unset" && alert.pushSubscriptions?.length) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, key);
    for (const sub of alert.pushSubscriptions) {
      try {
        await webpush.sendNotification(
          sub,
          JSON.stringify({ title: "Banana Radar", body, url: SITE_URL })
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) gone.push(sub.endpoint);
        else console.error("push failed", err.statusCode || err.message);
      }
    }
  }

  return { gone };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
