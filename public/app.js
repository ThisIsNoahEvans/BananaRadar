const form = document.querySelector("#search-form");
const searchBtn = document.querySelector("#search-btn");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const resultsEl = document.querySelector("#results");
const radarEl = document.querySelector("#radar");
const huntEl = document.querySelector("#search-progress");

const STATUS_COPY = {
  in_stock: "Banana's on",
  sold_out: "Sold out",
  unknown: "Can't tell",
};

const ANON_SKELETONS = 5;
const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

let abortController = null;
let searchSeq = 0;

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
  abortController?.abort();
  setSearching(true);
  beginSkeletonState("Finding you…");
  try {
    const pos = await getPosition();
    await runSearch(
      {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      },
      { skipIntro: true }
    );
  } catch (err) {
    if (err?.name === "AbortError") return;
    setSearching(false);
    summaryEl.hidden = true;
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    showStatus("Location was blocked. Search a postcode instead.");
  }
});

document.querySelectorAll("[data-place]").forEach((btn) => {
  btn.addEventListener("click", () => {
    placeInput.value = btn.dataset.place;
    form.requestSubmit();
  });
});

async function runSearch(params, { skipIntro = false } = {}) {
  abortController?.abort();
  abortController = new AbortController();
  const { signal } = abortController;
  const seq = ++searchSeq;

  setSearching(true);
  if (!skipIntro) beginSkeletonState();

  try {
    const data = await searchWithProgress(params, signal, (event) => {
      if (seq !== searchSeq) return;
      handleProgress(event);
    });
    if (seq !== searchSeq) return;
    render(data);
  } catch (err) {
    if (err?.name === "AbortError" || seq !== searchSeq) return;
    setSearching(false);
    summaryEl.hidden = true;
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    showStatus(err.message || "Something went banana-shaped.");
  }
}

async function searchWithProgress(params, signal, onEvent) {
  const query = new URLSearchParams(params);
  let res;
  try {
    res = await fetch(`/api/search/stream?${query}`, { signal });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return fetchJsonSearch(query, signal);
  }
  if (res.ok && res.body) {
    return readNdjson(res, signal, onEvent);
  }
  if (res.status === 404 || res.status === 405) {
    return fetchJsonSearch(query, signal);
  }
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error || "Search failed");
}

async function fetchJsonSearch(query, signal) {
  const res = await fetch(`/api/search?${query}`, { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Search failed");
  return data;
}

async function readNdjson(response, signal, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error(event.error || "Search failed");
      onEvent(event);
      if (event.type === "done") result = event;
    }
  }

  const leftover = buffer.trim();
  if (leftover) {
    const event = JSON.parse(leftover);
    if (event.type === "error") throw new Error(event.error || "Search failed");
    onEvent(event);
    if (event.type === "done") result = event;
  }

  if (!result) throw new Error("Search ended before any stores came back.");
  return result;
}

function handleProgress(event) {
  if (event.type === "origin") {
    const label = event.origin?.label || "your area";
    showStatus(`Found ${escapeHtml(label)}. Looking up nearby stores…`, {
      loading: true,
    });
    renderScanningSummary({
      origin: event.origin,
      total: 0,
      checked: 0,
      hits: 0,
      locating: true,
    });
    return;
  }

  if (event.type === "stores") {
    if (!event.stores?.length) return;
    showStatus("Checking live Starbucks menus…", { loading: true });
    renderScanningSummary({
      origin: event.origin,
      total: event.stores.length,
      checked: 0,
      hits: 0,
    });
    resultsEl.hidden = false;
    resultsEl.setAttribute("aria-busy", "true");
    resultsEl.innerHTML = event.stores.map(checkingCard).join("");
    return;
  }

  if (event.type === "store") {
    fillStoreCard(event.store);
    const cards = [...resultsEl.querySelectorAll("[data-store]")];
    const filled = cards.filter((el) => el.classList.contains("is-filled"));
    const hits = filled.filter((el) => el.dataset.status === "in_stock").length;
    renderScanningSummary({
      origin: event.store,
      label: summaryEl.dataset.label || "",
      total: cards.length,
      checked: filled.length,
      hits,
    });
    showStatus(
      `Checking live menus… ${filled.length} of ${cards.length} stores`,
      { loading: true }
    );
  }
}

function beginSkeletonState(status = "Finding nearby Starbucks…") {
  showStatus(status, { loading: true });
  summaryEl.hidden = false;
  summaryEl.dataset.label = "";
  summaryEl.innerHTML = `
    <div class="summary-card is-loading">
      <div>
        <h2>Warming up the radar…</h2>
        <p>Looking for stores and live banana menus.</p>
        <div class="progress-track">
          <div class="progress-bar is-indeterminate"></div>
        </div>
      </div>
      <div class="score score-muted">–/–</div>
    </div>
  `;
  resultsEl.hidden = false;
  resultsEl.setAttribute("aria-busy", "true");
  resultsEl.innerHTML = Array.from({ length: ANON_SKELETONS }, (_, i) =>
    skeletonCard(i)
  ).join("");
  summaryEl.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
}

function renderScanningSummary({ origin, label, total, checked, hits, locating }) {
  const place =
    label ||
    origin?.label ||
    summaryEl.dataset.label ||
    "";
  if (place) summaryEl.dataset.label = place;
  const near = place ? ` near ${escapeHtml(place)}` : "";
  const percent = total ? Math.round((checked / total) * 100) : 0;
  const indeterminate = locating || !checked;
  const detail = locating
    ? "Finding the closest stores on the map."
    : checked
      ? `${checked} of ${total} menus checked${near}${hits ? ` · ${hits} banana hit${hits === 1 ? "" : "s"} so far` : ""}.`
      : `Checking ${total} nearby store menu${total === 1 ? "" : "s"}${near}.`;

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card is-loading">
      <div>
        <h2>${locating ? "Pinpointing stores…" : "Scanning nearby menus…"}</h2>
        <p>${detail}</p>
        <div class="progress-track">
          <div class="progress-bar${indeterminate ? " is-indeterminate" : ""}"${indeterminate ? "" : ` style="width:${percent}%"`}></div>
        </div>
      </div>
      <div class="score${locating ? " score-muted" : ""}">${locating ? "–/–" : `${hits}/${total}`}</div>
    </div>
  `;
}

function render(data) {
  setSearching(false);
  const stores = data.stores || [];
  if (!stores.length) {
    summaryEl.hidden = true;
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    showStatus("No Starbucks found nearby. Try a broader place name.");
    return;
  }

  const hits = data.summary?.flavourInStock || 0;
  const label = data.origin?.label ? ` near ${data.origin.label}` : "";
  hideStatus();

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card is-ready">
      <div>
        <h2>${headline(hits, stores.length)}</h2>
        <p>${hits} of ${stores.length} nearby stores have the banana flavour on the menu${escapeHtml(label)}.</p>
      </div>
      <div class="score">${hits}/${stores.length}</div>
    </div>
  `;

  resultsEl.hidden = false;
  resultsEl.removeAttribute("aria-busy");

  const existing = resultsEl.querySelectorAll("[data-store]");
  if (existing.length === stores.length) {
    stores.forEach((store, index) => fillStoreCard(store, index, true));
    return;
  }

  resultsEl.innerHTML = stores
    .map((store, index) => storeCard(store, { filled: true, index }))
    .join("");
}

function headline(hits, total) {
  if (hits === 0) return "It's a sad banana day.";
  if (hits === total) return "The flavour is everywhere.";
  return "Banana spotted nearby.";
}

function skeletonCard(index) {
  return `
    <article class="card card-skeleton" style="animation-delay:${index * 55}ms" aria-hidden="true">
      <div class="card-top">
        <div>
          <span class="skel skel-title"></span>
          <span class="skel skel-meta"></span>
          <span class="skel skel-meta short"></span>
        </div>
        <span class="skel skel-badge"></span>
      </div>
      <div class="items">
        <span class="skel skel-chip"></span>
        <span class="skel skel-chip wide"></span>
        <span class="skel skel-chip"></span>
      </div>
    </article>
  `;
}

function checkingCard(store, index) {
  return `
    <article class="card is-checking" data-store="${escapeHtml(storeKey(store))}" style="animation-delay:${index * 55}ms" aria-busy="true">
      <div class="card-top">
        <div>
          <h3>${escapeHtml(store.name)}</h3>
          <p class="meta">
            ${formatKm(store.distanceKm)}
            ${store.isOpen ? "· Open" : "· Closed"}
            ${store.hoursLabel ? `· ${escapeHtml(store.hoursLabel)}` : ""}
            <br />${escapeHtml(store.address?.singleLine)}
          </p>
        </div>
        <span class="badge checking">
          <span class="badge-spinner" aria-hidden="true"></span>
          Checking
        </span>
      </div>
      <div class="items">
        <span class="skel skel-chip"></span>
        <span class="skel skel-chip wide"></span>
        <span class="skel skel-chip"></span>
      </div>
      <p class="card-wait">Waiting on the live menu…</p>
    </article>
  `;
}

function storeCard(store, { filled = false, index = 0 } = {}) {
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
  const delay = filled ? ` style="animation-delay:${index * 70}ms"` : "";

  return `
    <article class="card${filled ? " is-filled" : ""}" data-store="${escapeHtml(storeKey(store))}" data-status="${escapeHtml(store.status)}"${delay}>
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

function fillStoreCard(store, index = 0, stagger = false) {
  const key = storeKey(store);
  const current = resultsEl.querySelector(`[data-store="${cssEscape(key)}"]`);
  const html = storeCard(store, {
    filled: true,
    index: stagger ? index : 0,
  });
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  const next = wrap.firstElementChild;
  if (!current) {
    resultsEl.append(next);
    return;
  }
  if (current.classList.contains("is-filled") && current.dataset.status === store.status) {
    return;
  }
  current.replaceWith(next);
}

function storeKey(store) {
  return String(store.storeNumber || store.id || "");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 0.1) return "Right by you";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function showStatus(message, { loading = false } = {}) {
  statusEl.hidden = false;
  statusEl.classList.toggle("is-loading", loading);
  if (loading) {
    statusEl.innerHTML = `<span class="status-spinner" aria-hidden="true"></span><span>${message}</span>`;
    return;
  }
  statusEl.textContent = message;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.classList.remove("is-loading");
  statusEl.textContent = "";
}

function setSearching(on) {
  form.classList.toggle("is-searching", on);
  radarEl?.classList.toggle("is-scanning", on);
  huntEl.hidden = !on;
  searchBtn.disabled = on;
  locateBtn.disabled = on;
  form.setAttribute("aria-busy", on ? "true" : "false");
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
