import { searchBanana } from "./starbucks.js";
import {
  listSubscribersForLocation,
  listWatchesToCheck,
  markSubscriberNotified,
  saveWatchSnapshot,
  unsubscribeToken,
} from "./alerts.js";
import { notifyAlert } from "./notify.js";
import { SITE_URL, WATCH_BATCH } from "./config.js";

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

export async function runAlertChecks({
  resendKey,
  vapidPrivateKey,
  signingKey,
} = {}) {
  const watches = await listWatchesToCheck(WATCH_BATCH);
  let notified = 0;

  for (const watch of watches) {
    let result;
    try {
      result = await searchBanana({ lat: watch.lat, lng: watch.lng });
    } catch (err) {
      console.error("watch check failed", watch.id, err.message);
      continue;
    }

    const inStock = Boolean(result.summary?.flavourInStock);
    const previous = watch.lastFlavourInStock;
    const firstSnapshot = previous === undefined || previous === null;
    await saveWatchSnapshot(watch.id, { lastFlavourInStock: inStock });

    if (firstSnapshot || !(inStock && previous === false)) continue;

    const subscribers = await listSubscribersForLocation(watch.id);
    for (const alert of subscribers) {
      if (recentlyNotified(alert.lastNotifiedAt)) continue;
      const token = signingKey ? unsubscribeToken(alert.id, signingKey) : "";
      const { gone } = await notifyAlert({
        alert,
        stores: result.stores,
        resendKey,
        vapidPrivateKey,
        unsubscribeUrl: `${SITE_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`,
      });
      const pushSubscriptions = (alert.pushSubscriptions || []).filter(
        (sub) => !gone.includes(sub.endpoint)
      );
      await markSubscriberNotified(alert.id, pushSubscriptions);
      notified += 1;
    }
  }

  return { watches: watches.length, notified };
}

function recentlyNotified(value) {
  const ms = value?.toMillis?.() || (value ? new Date(value).getTime() : 0);
  return Boolean(ms && Date.now() - ms < COOLDOWN_MS);
}
