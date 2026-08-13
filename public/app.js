const OPEN_ONLY_KEY = "banana-radar:open-only";
const EMPTY_JOKE_KEY = "banana-empty-jokes";
const ANON_SKELETONS = 5;

const form = document.querySelector("#search-form");
const searchBtn = document.querySelector("#search-btn");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const toolbarEl = document.querySelector("#toolbar");
const openOnlyEl = document.querySelector("#open-only");
const filterNoteEl = document.querySelector("#filter-note");
const spotlightEl = document.querySelector("#spotlight");
const resultsEl = document.querySelector("#results");
const radarEl = document.querySelector(".radar");
const bananaEl = document.querySelector(".banana");
const huntEl = document.querySelector("#search-progress");
const watchesEl = document.querySelector("#watches");
const watchListEl = document.querySelector("#watch-list");
const watchHintEl = document.querySelector("#watch-hint");
const watchStatusEl = document.querySelector("#watch-status");
const installBtn = document.querySelector("#install");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let celebrateTimer = 0;
let abortController = null;
let searchSeq = 0;

const STATUS_COPY = {
  in_stock: "Banana's on",
  sold_out: "Sold out",
  unknown: "Can't tell",
};

const EMPTY_HEADLINES = [
  "It's a sad banana day.",
  "Nobody's gone bananas today.",
  "The bunch has left the building.",
  "Not a peel in sight.",
  "The flavour slipped away.",
  "Un-appeeling news, I'm afraid.",
  "A bunch of nothing.",
  "Banana left the chat.",
  "This neighbourhood is banana-free.",
  "Your local has not gone bananas.",
  "Zero bunches. Zero joy.",
  "It's a banana drought.",
  "Gone. Split. Vanished.",
  "Quiet on the yellow front.",
  "Today the banana clocked out.",
  "Bananas? In this economy?",
  "The bunch called in sick.",
  "A fruitless search, sadly.",
  "The flavour did a runner.",
  "This is a banana-less timeline.",
  "We've hit a banana-shaped hole.",
  "The tropics closed early.",
  "Banana went to a different postcode.",
  "The flavour is in another castle.",
  "Empty bunch energy.",
  "We checked. We wept. No banana.",
  "Forecast: grey, with no bananas.",
  "The yellow brick road is closed.",
  "Banana's on a break. A long one.",
  "Nothing yellow. Nothing to sip.",
  "Yellow alert: flavour's fled.",
  "Banana? We hardly knew ye.",
  "Potassium? More like no-tassium.",
  "Out of stock, out of luck, out of bananas.",
  "No banana, no glory.",
  "The menu's gone plain.",
  "All peel, no deal.",
  "Yellow's been cancelled.",
  "The great banana vanishing.",
  "Sold out faster than a holiday cup.",
  "Split's over. Flavour's gone.",
  "The bunch is in another store.",
  "Banana went brown and then went home.",
  "Seeking banana. Found only oat milk.",
  "Regular coffee only. Tragic.",
  "The caramelised banana caramelised off.",
  "No yellow in the radar return.",
  "Starbucks, but make it banana-less.",
  "The last banana left before you did.",
  "So close, and yet so un-banana.",
];

let lastResult = null;
let lastEmptyJoke = "";
let watchedStores = [];
let deferredInstall = null;

openOnlyEl.checked = readOpenOnly();
openOnlyEl.addEventListener("change", () => {
  try {
    localStorage.setItem(OPEN_ONLY_KEY, String(openOnlyEl.checked));
  } catch {
    /* private mode / blocked storage */
  }
  if (lastResult) render(lastResult, { doCelebrate: false });
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
      { skipIntro: true, updateUrl: false }
    );
  } catch (err) {
    if (err?.name === "AbortError") return;
    setSearching(false);
    hideListUi();
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
  abortController?.abort();
  setSearching(false);
  clearResults();
});

summaryEl.addEventListener("click", onShareClick);
spotlightEl.addEventListener("click", onResultsClick);
resultsEl.addEventListener("click", onResultsClick);
watchListEl.addEventListener("click", onResultsClick);

const initialQ = queryFromUrl();
if (initialQ) {
  placeInput.value = initialQ;
  runSearch({ q: initialQ }, { updateUrl: false });
}

async function runSearch(params, { skipIntro = false, updateUrl = true } = {}) {
  abortController?.abort();
  abortController = new AbortController();
  const { signal } = abortController;
  const seq = ++searchSeq;

  bananaEl.classList.remove("happy");
  radarEl.classList.remove("found");
  document.querySelector(".celebrate")?.remove();
  setSearching(true);
  if (updateUrl) syncSearchUrl(params.q);
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
    hideListUi();
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
  toolbarEl.hidden = true;
  spotlightEl.hidden = true;
  spotlightEl.innerHTML = "";
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
  summaryEl.scrollIntoView({
    behavior: reducedMotion.matches ? "auto" : "smooth",
    block: "nearest",
  });
}

function renderScanningSummary({ origin, label, total, checked, hits, locating }) {
  const place = label || origin?.label || summaryEl.dataset.label || "";
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

function render(data, { doCelebrate = true } = {}) {
  lastResult = data;
  setSearching(false);
  const stores = data.stores || [];
  if (!stores.length) {
    hideListUi();
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
  const checkedAt = formatCheckedAt(data.checkedAt);
  const nearestHit = visible.find((store) => store.flavourInStock);
  const emptyJoke =
    hits === 0
      ? doCelebrate
        ? nextEmptyHeadline()
        : lastEmptyJoke || nextEmptyHeadline()
      : "";
  lastEmptyJoke = emptyJoke;
  const shareText = nearestHit
    ? shareLine(nearestHit)
    : `${(emptyJoke || "It's a sad banana day.").replace(/\.$/, "")}${label} — none of the ${visible.length || stores.length} nearby stores have the banana flavour.`;
  hideStatus();

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card${hits ? " hit" : ""} is-ready">
      <div>
        <h2>${escapeHtml(headline(hits, visible.length, {
          closedHits,
          noneVisible: visible.length === 0,
          emptyJoke,
        }))}</h2>
        <p>${summaryCopy(hits, visible.length, stores.length, label, openOnlyEl.checked)}</p>
        ${checkedAt ? `<p class="checked-at">${escapeHtml(checkedAt)}</p>` : ""}
        <button type="button" class="btn ghost share-btn" data-share-text="${escapeHtml(shareText)}">
          Share
        </button>
      </div>
      <div class="score">${visible.length ? `${hits}/${visible.length}` : "0"}</div>
    </div>
  `;

  toolbarEl.hidden = false;
  filterNoteEl.textContent =
    openOnlyEl.checked && hiddenClosed
      ? `${hiddenClosed} closed ${hiddenClosed === 1 ? "store" : "stores"} hidden`
      : "";

  if (nearestHit) {
    spotlightEl.hidden = false;
    spotlightEl.innerHTML = spotlightCard(nearestHit, hits);
  } else {
    spotlightEl.hidden = true;
    spotlightEl.innerHTML = "";
  }

  const rest = nearestHit
    ? visible.filter((store) => storeKey(store) !== storeKey(nearestHit))
    : visible;

  resultsEl.removeAttribute("aria-busy");
  if (!rest.length) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = visible.length
      ? ""
      : `<p class="empty">All nearby stores are closed. Turn off Open only to see them.</p>`;
  } else {
    resultsEl.hidden = false;
    resultsEl.innerHTML =
      (nearestHit ? `<p class="results-label">Other nearby stores</p>` : "") +
      rest.map((store, index) => storeCard(store, { filled: true, index })).join("");
  }

  if (doCelebrate && hits > 0) celebrate();
}

function hideListUi() {
  toolbarEl.hidden = true;
  spotlightEl.hidden = true;
  spotlightEl.innerHTML = "";
  summaryEl.hidden = true;
  resultsEl.hidden = true;
  resultsEl.innerHTML = "";
}

function clearResults() {
  hideStatus();
  hideListUi();
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

function headline(hits, total, { closedHits = 0, noneVisible = false, emptyJoke = "" } = {}) {
  if (noneVisible) return "Everyone's closed.";
  if (hits === 0 && closedHits > 0) {
    return "Banana's on — but those stores are closed.";
  }
  if (hits === 0) return emptyJoke || nextEmptyHeadline();
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

function nextEmptyHeadline() {
  let queue = [];
  try {
    queue = JSON.parse(sessionStorage.getItem(EMPTY_JOKE_KEY) || "[]");
  } catch {
    queue = [];
  }
  if (!Array.isArray(queue) || queue.length === 0) {
    queue = shuffle(EMPTY_HEADLINES.map((_, i) => i));
  }
  const index = queue.pop();
  try {
    sessionStorage.setItem(EMPTY_JOKE_KEY, JSON.stringify(queue));
  } catch {
    // Private mode can block sessionStorage; still return a joke.
  }
  return EMPTY_HEADLINES[index] || EMPTY_HEADLINES[0];
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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

function spotlightCard(store, hitCount) {
  const others = Math.max(0, hitCount - 1);
  const also =
    others > 0
      ? `<p class="spotlight-also">${
          others === 1
            ? "1 more nearby store has it too."
            : `${others} more nearby stores have it too.`
        }</p>`
      : "";

  return `
    <article class="spotlight-card">
      <p class="spotlight-kicker">Nearest banana</p>
      <div class="card-top">
        <div>
          <h2>${escapeHtml(store.name)}</h2>
          <p class="meta">
            ${formatKm(store.distanceKm)}
            ${store.isOpen ? "· Open" : "· Closed"}
            ${store.hoursLabel ? `· ${escapeHtml(store.hoursLabel)}` : ""}
            <br />${escapeHtml(store.address.singleLine)}
          </p>
        </div>
        <span class="badge in_stock">${STATUS_COPY.in_stock}</span>
      </div>
      <div class="items">
        ${itemChips(store)}
      </div>
      ${also}
      <div class="spotlight-actions">
        <a class="btn primary" href="${mapsUrl(store)}" target="_blank" rel="noreferrer">Go here</a>
        <a class="btn secondary" href="${starbucksUrl(store)}" target="_blank" rel="noreferrer">Starbucks page</a>
        <button type="button" class="share-link" data-share-text="${escapeHtml(shareLine(store))}">
          Share
        </button>
        ${watchButton(store)}
      </div>
    </article>
  `;
}

function storeCard(store, { filled = false, index = 0 } = {}) {
  const badge = STATUS_COPY[store.status] || STATUS_COPY.unknown;
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
        ${itemChips(store)}
      </div>
      <div class="card-links">
        <a href="${mapsUrl(store)}" target="_blank" rel="noreferrer">Directions</a>
        <a href="${starbucksUrl(store)}" target="_blank" rel="noreferrer">Starbucks page</a>
        <button type="button" class="share-link" data-share-text="${escapeHtml(shareLine(store))}">
          Share
        </button>
        ${watchButton(store)}
      </div>
    </article>
  `;
}

function watchButton(store) {
  return `
    <button
      type="button"
      class="watch-link${isWatched(store.storeNumber) ? " is-watching" : ""}"
      data-watch="toggle"
      data-store-number="${escapeHtml(store.storeNumber)}"
      data-store-name="${escapeHtml(store.name)}"
      data-store-market="${escapeHtml(store.market)}"
      data-store-country="${escapeHtml(store.address?.countryCode || store.countryCode || "")}"
    >
      ${isWatched(store.storeNumber) ? "Watching" : "Notify me"}
    </button>
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

function itemChips(store) {
  const items = store.items || [];
  if (!items.length) {
    return `<span class="chip">No banana drinks on this store’s published menu</span>`;
  }
  return items
    .map(
      (item) => `
        <span class="chip">
          <span class="dot ${item.inStock ? "ok" : ""}"></span>
          ${escapeHtml(item.name)}
        </span>`
    )
    .join("");
}

function mapsUrl(store) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${store.coordinates.latitude},${store.coordinates.longitude}`
  )}`;
}

function starbucksUrl(store) {
  return store.market === "us"
    ? `https://www.starbucks.com/store-locator/store/${store.id}`
    : `https://www.starbucks.co.uk/store-locator/${store.storeNumber}`;
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 0.1) return "Right by you";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function formatCheckedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Checked ${time}`;
}

function shareLine(store) {
  const distance = formatKm(store.distanceKm);
  const where = distance ? `${store.name} (${distance})` : store.name;
  if (store.flavourInStock) return `Banana's on at ${where}`;
  if (store.status === "sold_out") return `Banana's sold out at ${where}`;
  return `Can't tell if banana's on at ${where}`;
}

function onShareClick(event) {
  const btn = event.target.closest("[data-share-text]");
  if (!btn) return;
  shareOrCopy(btn.dataset.shareText, btn);
}

async function shareOrCopy(text, button) {
  const payload = { title: "Banana Radar", text };
  try {
    if (typeof navigator.share === "function") {
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return;
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }

  try {
    await copyText(text);
    flashLabel(button, "Copied!");
  } catch {
    flashLabel(button, "Couldn't copy");
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand("copy");
  input.remove();
  if (!ok) throw new Error("copy failed");
}

function flashLabel(button, label) {
  const original = button.dataset.shareLabel || button.textContent.trim();
  button.dataset.shareLabel = original;
  button.textContent = label;
  window.clearTimeout(Number(button.dataset.shareTimer));
  button.dataset.shareTimer = String(
    window.setTimeout(() => {
      button.textContent = original;
    }, 1600)
  );
}

function celebrate() {
  if (reducedMotion.matches) return;

  bananaEl.classList.remove("happy");
  radarEl.classList.remove("found");
  void bananaEl.offsetWidth;
  bananaEl.classList.add("happy");
  radarEl.classList.add("found");

  burstBananas();

  window.clearTimeout(celebrateTimer);
  celebrateTimer = window.setTimeout(() => {
    bananaEl.classList.remove("happy");
    radarEl.classList.remove("found");
  }, 1600);
}

function burstBananas() {
  document.querySelector(".celebrate")?.remove();

  const layer = document.createElement("div");
  layer.className = "celebrate";
  layer.setAttribute("aria-hidden", "true");

  const origin = bananaEl.getBoundingClientRect();
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;
  const bits = [
    "🍌",
    "🍌",
    "🍌",
    "🍌",
    "🍌",
    "🍌",
    "dot",
    "dot",
    "dot",
    "dot",
    "chip",
    "chip",
    "chip",
    "chip",
  ];

  for (const kind of bits) {
    const piece = document.createElement("span");
    piece.className = `celebrate-piece ${kind === "🍌" ? "emoji" : `confetti-${kind}`}`;
    if (kind === "🍌") piece.textContent = kind;

    const angle = (Math.random() * 140 - 70) * (Math.PI / 180);
    const dist = 90 + Math.random() * 160;
    piece.style.setProperty("--x", `${cx}px`);
    piece.style.setProperty("--y", `${cy}px`);
    piece.style.setProperty("--dx", `${Math.sin(angle) * dist}px`);
    piece.style.setProperty("--dy", `${70 + Math.random() * 90}px`);
    piece.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 280}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 90}ms`);
    piece.style.setProperty("--dur", `${900 + Math.random() * 500}ms`);
    piece.style.setProperty("--size", `${18 + Math.random() * 10}px`);
    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1700);
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
  if (huntEl) huntEl.hidden = !on;
  if (searchBtn) searchBtn.disabled = on;
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

function isWatched(storeNumber) {
  return watchedStores.some((store) => store.storeNumber === String(storeNumber));
}

function onResultsClick(event) {
  const watchBtn = event.target.closest("[data-watch]");
  if (watchBtn) {
    toggleWatch(watchBtn);
    return;
  }
  onShareClick(event);
}

async function toggleWatch(button) {
  const store = {
    storeNumber: button.dataset.storeNumber,
    name: button.dataset.storeName,
    market: button.dataset.storeMarket,
    countryCode: button.dataset.storeCountry,
  };
  const watching = isWatched(store.storeNumber);
  button.disabled = true;
  try {
    if (watching) {
      await unwatchStore(store.storeNumber);
      setWatchStatus(`Stopped watching ${store.name}.`);
    } else {
      await watchStore(store);
      setWatchStatus(`Watching ${store.name}. We'll ping you when banana's back.`);
    }
    if (lastResult) render(lastResult, { doCelebrate: false });
  } catch (err) {
    setWatchStatus(err.message || "Couldn't update that watch.");
  } finally {
    button.disabled = false;
  }
}

async function watchStore(store) {
  const subscription = await subscribePush();
  const res = await fetch("/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription, store }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not watch that store.");
  watchedStores = data.stores || [];
  renderWatchList();
}

async function unwatchStore(storeNumber) {
  const subscription = await subscribePush();
  const res = await fetch("/api/watch", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription, storeNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not stop watching.");
  watchedStores = data.stores || [];
  renderWatchList();
}

function renderWatchList() {
  if (!watchesEl) return;
  const hasWatches = watchedStores.length > 0;
  watchesEl.hidden = !hasWatches && !watchStatusEl?.textContent;
  if (watchHintEl) {
    watchHintEl.textContent = hasWatches
      ? "We'll ping this device when banana flavour comes back at these stores."
      : "Tap Notify me on a store to watch it. No account.";
  }
  watchListEl.innerHTML = watchedStores
    .map(
      (store) => `
        <li>
          <span>${escapeHtml(store.name)}</span>
          <button
            type="button"
            class="watch-link is-watching"
            data-watch="toggle"
            data-store-number="${escapeHtml(store.storeNumber)}"
            data-store-name="${escapeHtml(store.name)}"
            data-store-market="${escapeHtml(store.market)}"
            data-store-country="${escapeHtml(store.countryCode || "")}"
          >
            Stop
          </button>
        </li>`
    )
    .join("");
}

function setWatchStatus(message) {
  if (!watchStatusEl) return;
  watchStatusEl.hidden = !message;
  watchStatusEl.textContent = message || "";
  if (message) watchesEl.hidden = false;
}

async function subscribePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser can't do push notifications.");
  }
  if (isIos() && !isStandalone()) {
    throw new Error(
      "On iPhone, add Banana Radar to your Home Screen first (Share → Add to Home Screen), then tap Notify me."
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications were blocked for this site.");
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing.toJSON();
  const keyRes = await fetch("/api/push/key");
  const { publicKey } = await keyRes.json();
  if (!publicKey) throw new Error("Push isn't configured on the server yet.");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return sub.toJSON();
}

async function refreshWatches() {
  try {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") {
      renderWatchList();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      renderWatchList();
      return;
    }
    const res = await fetch("/api/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    const data = await res.json();
    if (res.ok) watchedStores = data.stores || [];
    renderWatchList();
  } catch {
    renderWatchList();
  }
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(refreshWatches).catch(() => {});
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event;
  if (installBtn && !isStandalone()) installBtn.hidden = false;
});

installBtn?.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  installBtn.hidden = true;
});
