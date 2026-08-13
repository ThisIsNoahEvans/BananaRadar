const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const UK_POSTCODE =
  /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const PRODUCT_RE =
  /\\"type\\":\\"product\\",\\"outOfStock\\":(true|false),\\"name\\":\\"([^\\"]+)\\",\\"id\\":\\"([^\\"]+)\\"/g;

const cache = new Map();
const MENU_TTL_MS = 3 * 60 * 1000;
const STORE_LIMIT = 8;

export async function searchBanana({ lat, lng, q } = {}) {
  const origin = await resolveOrigin({ lat, lng, q });
  const market = marketFor(origin.lat, origin.lng);
  const stores = await findStores(origin.lat, origin.lng, market);
  const nearest = stores.slice(0, STORE_LIMIT);
  const checked = await mapLimit(nearest, 4, (store) => checkStore(store));

  const inStock = checked.filter((s) => s.flavourInStock).length;

  return {
    origin,
    market,
    checkedAt: new Date().toISOString(),
    summary: {
      stores: checked.length,
      flavourInStock: inStock,
    },
    stores: checked,
  };
}

async function resolveOrigin({ lat, lng, q }) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      throw new Error("Those coordinates look off the map.");
    }
    return { lat: parsedLat, lng: parsedLng, label: "Your location" };
  }

  const query = String(q || "").trim();
  if (!query) {
    throw new Error("Share your location or type a postcode / place.");
  }

  if (UK_POSTCODE.test(query)) {
    return geocodeUkPostcode(query);
  }
  return geocodePlace(query);
}

async function geocodeUkPostcode(postcode) {
  const compact = postcode.replace(/\s+/g, "");
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`;
  const data = await fetchJson(url, {}, 8000);
  if (data.status !== 200 || !data.result) {
    throw new Error("Couldn't find that UK postcode.");
  }
  const r = data.result;
  return {
    lat: r.latitude,
    lng: r.longitude,
    label: r.postcode,
  };
}

async function geocodePlace(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q: query,
      format: "json",
      limit: "1",
      addressdetails: "1",
    });
  const results = await fetchJson(
    url,
    { headers: { "User-Agent": "StarbucksBanana/1.0 (local flavour checker)" } },
    8000
  );
  if (!Array.isArray(results) || !results[0]) {
    throw new Error("Couldn't find that place.");
  }
  const hit = results[0];
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: hit.display_name.split(",").slice(0, 3).join(","),
  };
}

function marketFor(lat, lng) {
  // British Isles, including Ireland — Starbucks EMEA menus.
  if (lat >= 49.5 && lat <= 61 && lng >= -11 && lng <= 2.2) return "uk";
  return "us";
}

async function findStores(lat, lng, market) {
  if (market === "uk") {
    const uk = await findUkStores(lat, lng);
    if (uk.length) return uk;
    return findUsStores(lat, lng);
  }
  const us = await findUsStores(lat, lng);
  if (us.length) return us;
  return findUkStores(lat, lng);
}

async function findUkStores(lat, lng) {
  const params = new URLSearchParams({
    "filter[coordinates][latitude]": String(lat),
    "filter[coordinates][longitude]": String(lng),
    "filter[radius]": "8",
  });
  const url = `https://www.starbucks.co.uk/api/v2/stores/?${params}`;
  const payload = await fetchJson(
    url,
    {
      headers: {
        Accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        "User-Agent": BROWSER_UA,
      },
    },
    10000
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row) => {
      const a = row.attributes || {};
      const addr = a.address || {};
      const coords = a.coordinates || {};
      const hours = a.todayHours || {};
      return {
        id: String(row.id),
        storeNumber: a.storeNumber,
        name: a.name,
        phone: a.phoneNumber || null,
        address: {
          street: addr.streetAddressLine1 || "",
          city: addr.city || "",
          postalCode: addr.postalCode || "",
          countryCode: addr.countryCode || "GB",
          singleLine: [addr.streetAddressLine1, addr.city, addr.postalCode]
            .filter(Boolean)
            .join(", "),
        },
        coordinates: {
          latitude: coords.latitude,
          longitude: coords.longitude,
        },
        isOpen: Boolean(hours.openAsOfLocalTime ?? a.isOpen),
        hoursLabel: formatUkHours(hours),
        mobileOrder: Boolean(a.isOrderingAllowed),
        market: addr.countryCode === "US" || addr.countryCode === "CA" ? "us" : "uk",
        distanceKm: haversine(lat, lng, coords.latitude, coords.longitude),
      };
    })
    .filter((s) => s.storeNumber && Number.isFinite(s.coordinates.latitude))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

async function findUsStores(lat, lng) {
  const url = `https://www.starbucks.com/apiproxy/v1/locations?lat=${encodeURIComponent(
    lat
  )}&lng=${encodeURIComponent(lng)}`;
  const payload = await fetchJson(
    url,
    {
      headers: {
        Accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        "User-Agent": BROWSER_UA,
      },
    },
    10000
  );
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const s = row.store || {};
      const addr = s.address || {};
      const coords = s.coordinates || {};
      const amenities = s.amenities || [];
      return {
        id: String(s.id || s.storeNumber),
        storeNumber: s.storeNumber,
        name: s.name,
        phone: s.phoneNumber || null,
        address: {
          street: addr.streetAddressLine1 || (addr.lines && addr.lines[0]) || "",
          city: addr.city || "",
          postalCode: addr.postalCode || "",
          countryCode: addr.countryCode || "US",
          singleLine:
            addr.singleLine ||
            [addr.streetAddressLine1, addr.city, addr.postalCode]
              .filter(Boolean)
              .join(", "),
        },
        coordinates: {
          latitude: coords.latitude,
          longitude: coords.longitude,
        },
        isOpen: Boolean(s.open),
        hoursLabel: s.hoursStatusFormatted || s.openStatusFormatted || null,
        mobileOrder: amenities.some((a) => a.code === "XO"),
        market: "us",
        distanceKm:
          typeof row.distance === "number"
            ? row.distance * 1.60934
            : haversine(lat, lng, coords.latitude, coords.longitude),
      };
    })
    .filter((s) => s.storeNumber)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export async function checkStoreMenu(store) {
  return checkStore(store);
}

async function checkStore(store) {
  try {
    const { items, catalogSize } =
      store.market === "us"
        ? await usBananaItems(store.storeNumber)
        : await ukBananaItems(store);
    const flavourInStock = items.some((item) => item.inStock);
    const status = flavourInStock
      ? "in_stock"
      : items.length || catalogSize >= 20
        ? "sold_out"
        : "unknown";

    return {
      ...store,
      status,
      flavourInStock,
      items,
      checked: true,
    };
  } catch {
    return {
      ...store,
      status: "unknown",
      flavourInStock: false,
      items: [],
      checked: false,
      error: "Menu not published for this store",
    };
  }
}

async function ukBananaItems(store) {
  const hosts =
    store.address.countryCode === "IE"
      ? ["https://www.starbucks.ie", "https://www.starbucks.co.uk"]
      : ["https://www.starbucks.co.uk"];

  let lastError;
  for (const host of hosts) {
    try {
      return await parseUkMenu(host, store.storeNumber);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Menu not published for this store");
}

async function parseUkMenu(host, storeNumber) {
  const html = await cached(`uk-menu:${host}:${storeNumber}`, MENU_TTL_MS, () =>
    fetchText(
      `${host}/menu/${storeNumber}`,
      {
        headers: {
          Accept: "text/html",
          "User-Agent": BROWSER_UA,
        },
      },
      14000
    )
  );

  const found = new Map();
  let catalogSize = 0;
  PRODUCT_RE.lastIndex = 0;
  let match;
  while ((match = PRODUCT_RE.exec(html))) {
    catalogSize += 1;
    const name = decodeJsonString(match[2]);
    if (!/banana/i.test(name) || isFood(name)) continue;
    found.set(match[3], {
      id: match[3],
      name,
      inStock: match[1] === "false",
    });
  }
  return { items: [...found.values()].sort(sortItems), catalogSize };
}

async function usBananaItems(storeNumber) {
  const menu = await cached(`us-menu:${storeNumber}`, MENU_TTL_MS, () =>
    fetchJson(
      `https://www.starbucks.com/apiproxy/v1/ordering/menu?storeNumber=${encodeURIComponent(
        storeNumber
      )}`,
      {
        headers: {
          Accept: "application/json",
          "x-requested-with": "XMLHttpRequest",
          "User-Agent": BROWSER_UA,
        },
      },
      14000
    )
  );

  const found = new Map();
  let catalogSize = 0;
  walk(menu, (node) => {
    if (!node?.name || node.productNumber == null) return;
    catalogSize += 1;
    if (!/banana/i.test(node.name) || isFood(node.name)) return;
    const inStock = String(node.availability || "") === "Available";
    found.set(String(node.productNumber), {
      id: String(node.productNumber),
      name: node.name,
      inStock,
    });
  });
  return { items: [...found.values()].sort(sortItems), catalogSize };
}

function isFood(name) {
  return /\b(loaf|cake|cookie|muffin|scone|organics|chips|bar)\b/i.test(name);
}

function sortItems(a, b) {
  return a.name.localeCompare(b.name);
}

function formatUkHours(hours) {
  if (!hours) return null;
  if (hours.open24Hours) return "Open 24 hours";
  if (!hours.open) return "Closed today";
  const open = String(hours.openTime || "").slice(0, 5);
  const close = String(hours.closeTime || "").slice(0, 5);
  if (open && close) return `${to12(open)} – ${to12(close)}`;
  return null;
}

function to12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? "pm" : "am";
  const hour = ((h + 11) % 12) + 1;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

function haversine(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node && typeof node === "object") {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

function decodeJsonString(value) {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.value;
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + ttl });
  return value;
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function fetchJson(url, init, timeoutMs) {
  const text = await fetchText(url, init, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Starbucks sent a non-JSON response");
  }
}

async function fetchText(url, init = {}, timeoutMs = 10000) {
  const response = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: init.headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return text;
}
