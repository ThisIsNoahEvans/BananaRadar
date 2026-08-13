const OPEN_ONLY_KEY = "banana-radar:open-only";

const form = document.querySelector("#search-form");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const toolbarEl = document.querySelector("#toolbar");
const openOnlyEl = document.querySelector("#open-only");
const filterNoteEl = document.querySelector("#filter-note");
const resultsEl = document.querySelector("#results");

const STATUS_COPY = {
  in_stock: "Banana's on",
  sold_out: "Sold out",
  unknown: "Can't tell",
};

let lastResult = null;

openOnlyEl.checked = readOpenOnly();
openOnlyEl.addEventListener("change", () => {
  try {
    localStorage.setItem(OPEN_ONLY_KEY, String(openOnlyEl.checked));
  } catch {
    /* private mode / blocked storage */
  }
  if (lastResult) render(lastResult);
});

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
  btn.addEventListener("click", () => {
    placeInput.value = btn.dataset.place;
    form.requestSubmit();
  });
});

async function runSearch(params) {
  showStatus("Checking live Starbucks menus… this takes a few seconds.");
  summaryEl.hidden = true;
  toolbarEl.hidden = true;
  resultsEl.hidden = true;
  locateBtn.disabled = true;

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

function render(data) {
  lastResult = data;
  const stores = data.stores || [];
  if (!stores.length) {
    toolbarEl.hidden = true;
    showStatus("No Starbucks found nearby. Try a broader place name.");
    return;
  }

  const ranked = sortInStockFirst(stores);
  const visible = openOnlyEl.checked
    ? ranked.filter((store) => store.isOpen)
    : ranked;
  const hiddenClosed = stores.length - visible.length;
  const hits = visible.filter((store) => store.flavourInStock).length;
  const closedHits = stores.filter(
    (store) => store.flavourInStock && !store.isOpen
  ).length;
  const label = data.origin?.label ? ` near ${data.origin.label}` : "";
  statusEl.hidden = true;

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card">
      <div>
        <h2>${headline(hits, visible.length, {
          closedHits,
          noneVisible: visible.length === 0,
        })}</h2>
        <p>${summaryCopy(hits, visible.length, stores.length, label, openOnlyEl.checked)}</p>
      </div>
      <div class="score">${visible.length ? `${hits}/${visible.length}` : "0"}</div>
    </div>
  `;

  toolbarEl.hidden = false;
  filterNoteEl.textContent =
    openOnlyEl.checked && hiddenClosed
      ? `${hiddenClosed} closed ${hiddenClosed === 1 ? "store" : "stores"} hidden`
      : "";

  resultsEl.hidden = false;
  resultsEl.innerHTML = visible.length
    ? visible.map(storeCard).join("")
    : `<p class="empty">All nearby stores are closed. Turn off Open only to see them.</p>`;
}

function headline(hits, total, { closedHits = 0, noneVisible = false } = {}) {
  if (noneVisible) return "Everyone's closed.";
  if (hits === 0 && closedHits > 0) {
    return "Banana's on — but those stores are closed.";
  }
  if (hits === 0) return "It's a sad banana day.";
  if (total > 0 && hits === total) return "The flavour is everywhere.";
  return "Banana spotted nearby.";
}

function summaryCopy(hits, visibleCount, total, label, openOnly) {
  if (openOnly && visibleCount === 0) {
    return `None of the ${total} nearby stores are open${label}.`;
  }
  if (openOnly) {
    return `${hits} of ${visibleCount} open stores have the banana flavour on the menu${label}.`;
  }
  return `${hits} of ${total} nearby stores have the banana flavour on the menu${label}.`;
}

function sortInStockFirst(stores) {
  return [...stores].sort((a, b) => {
    if (Boolean(a.flavourInStock) !== Boolean(b.flavourInStock)) {
      return a.flavourInStock ? -1 : 1;
    }
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
  });
}

function readOpenOnly() {
  try {
    const saved = localStorage.getItem(OPEN_ONLY_KEY);
    if (saved === "false") return false;
    if (saved === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
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
