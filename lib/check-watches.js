import { checkStoreMenu, mapLimit } from "./starbucks.js";
import {
  deleteDeviceAndWatches,
  getDevice,
  listAllWatches,
  markWatchNotified,
  saveWatchSnapshot,
} from "./watches.js";
import { sendStorePush } from "./notify.js";
import { SITE_URL } from "./config.js";

const STORE_BATCH = 40;

export async function runWatchChecks({ vapidPrivateKey } = {}) {
  const watches = await listAllWatches();
  const byStore = new Map();
  for (const watch of watches) {
    const list = byStore.get(watch.storeNumber) || [];
    list.push(watch);
    byStore.set(watch.storeNumber, list);
  }

  const unique = [...byStore.values()].map((list) => list[0]).slice(0, STORE_BATCH);
  const checked = await mapLimit(unique, 3, (watch) =>
    checkStoreMenu({
      storeNumber: watch.storeNumber,
      name: watch.name,
      market: watch.market,
      address: {
        countryCode: watch.countryCode || (watch.market === "us" ? "US" : "GB"),
      },
    })
  );

  let notified = 0;
  for (const result of checked) {
    const inStock = Boolean(result.flavourInStock);
    const watchers = byStore.get(result.storeNumber) || [];
    for (const watch of watchers) {
      const previous = watch.lastFlavourInStock;
      const firstSnapshot = previous === undefined || previous === null;
      await saveWatchSnapshot(watch.id, {
        lastFlavourInStock: inStock,
        status: result.status,
        name: result.name || watch.name,
      });
      if (firstSnapshot || !(inStock && previous !== true)) continue;

      const device = await getDevice(watch.deviceId);
      if (!device?.endpoint || !device?.keys) continue;
      try {
        await sendStorePush({
          subscription: {
            endpoint: device.endpoint,
            keys: device.keys,
          },
          storeName: result.name || watch.name,
          vapidPrivateKey,
          url: SITE_URL,
        });
        await markWatchNotified(watch.id);
        notified += 1;
      } catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await deleteDeviceAndWatches(watch.deviceId);
        } else {
          console.error("push failed", watch.id, err.message);
        }
      }
    }
  }

  return { watches: watches.length, stores: unique.length, notified };
}
