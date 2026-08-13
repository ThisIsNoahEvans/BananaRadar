const form = document.querySelector("#search-form");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const resultsEl = document.querySelector("#results");

const STATUS_COPY = {
  in_stock: "Banana's on",
  sold_out: "Sold out",
  unknown: "Can't tell",
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = placeInput.value.trim();
  if (!q) {
    showStatus("Type a postcode or place first — or use your location.");
    return;
  }
  await runSearch({ q });
});

locateBtn.addEventListener("click", async () => {
  showStatus("Finding you…");
  try {
    const pos = await getPosition();
    await runSearch({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    });
  } catch {
    showStatus("Location was blocked. Search a postcode instead.");
  }
});

document.querySelectorAll("[data-place]").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    placeInput.value = btn.dataset.place;
    form.requestSubmit();
  });
});

window.addEventListener("popstate", () => {
  const q = queryFromUrl();
  if (q) {
    placeInput.value = q;
    runSearch({ q }, { updateUrl: false });
    return;
  }
  placeInput.value = "";
  clearResults();
});

const initialQ = queryFromUrl();
if (initialQ) {
  placeInput.value = initialQ;
  runSearch({ q: initialQ }, { updateUrl: false });
}

async function runSearch(params, { updateUrl = true } = {}) {
  showStatus("Checking live Starbucks menus… this takes a few seconds.");
  summaryEl.hidden = true;
  resultsEl.hidden = true;
  locateBtn.disabled = true;
  if (updateUrl) syncSearchUrl(params.q);

  try {
    const query = new URLSearchParams(params);
    const res = await fetch(`/api/search?${query}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    render(data);
  } catch (err) {
    showStatus(err.message || "Something went banana-shaped.");
  } finally {
    locateBtn.disabled = false;
  }
}

function queryFromUrl() {
  return new URLSearchParams(location.search).get("q")?.trim() || "";
}

function syncSearchUrl(q) {
  const next = q
    ? `${location.pathname}?${new URLSearchParams({ q })}`
    : location.pathname;
  const current = `${location.pathname}${location.search}`;
  if (current === next) return;
  history.pushState(q ? { q } : {}, "", next);
}

function clearResults() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  summaryEl.hidden = true;
  summaryEl.innerHTML = "";
  resultsEl.hidden = true;
  resultsEl.innerHTML = "";
}

function render(data) {
  const stores = data.stores || [];
  if (!stores.length) {
    showStatus("No Starbucks found nearby. Try a broader place name.");
    return;
  }

  const hits = data.summary?.flavourInStock || 0;
  const label = data.origin?.label ? ` near ${data.origin.label}` : "";
  statusEl.hidden = true;

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card">
      <div>
        <h2>${headline(hits, stores.length)}</h2>
        <p>${hits} of ${stores.length} nearby stores have the banana flavour on the menu${label}.</p>
      </div>
      <div class="score">${hits}/${stores.length}</div>
    </div>
  `;

  resultsEl.hidden = false;
  resultsEl.innerHTML = stores.map(storeCard).join("");
}

function headline(hits, total) {
  if (hits === 0) return "It's a sad banana day.";
  if (hits === total) return "The flavour is everywhere.";
  return "Banana spotted nearby.";
}

function storeCard(store) {
  const badge = STATUS_COPY[store.status] || STATUS_COPY.unknown;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${store.coordinates.latitude},${store.coordinates.longitude}`
  )}`;
  const sbux =
    store.market === "us"
      ? `https://www.starbucks.com/store-locator/store/${store.id}`
      : `https://www.starbucks.co.uk/store-locator/${store.storeNumber}`;
  const items = (store.items || [])
    .map(
      (item) => `
        <span class="chip">
          <span class="dot ${item.inStock ? "ok" : ""}"></span>
          ${escapeHtml(item.name)}
        </span>`
    )
    .join("");

  return `
    <article class="card">
      <div class="card-top">
        <div>
          <h3>${escapeHtml(store.name)}</h3>
          <p class="meta">
            ${formatKm(store.distanceKm)}
            ${store.isOpen ? "· Open" : "· Closed"}
            ${store.hoursLabel ? `· ${escapeHtml(store.hoursLabel)}` : ""}
            <br />${escapeHtml(store.address.singleLine)}
          </p>
        </div>
        <span class="badge ${store.status}">${badge}</span>
      </div>
      <div class="items">
        ${items || `<span class="chip">No live banana items on this store’s published menu</span>`}
      </div>
      <div class="card-links">
        <a href="${maps}" target="_blank" rel="noreferrer">Directions</a>
        <a href="${sbux}" target="_blank" rel="noreferrer">Starbucks page</a>
      </div>
    </article>
  `;
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 0.1) return "Right by you";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function showStatus(message) {
  statusEl.hidden = false;
  statusEl.textContent = message;
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("no geo"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
