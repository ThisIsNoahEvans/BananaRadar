const OPEN_ONLY_KEY = "banana-radar:open-only";
const UNIT_KEY = "banana-radar:distance-unit";
const EMPTY_JOKE_KEY = "banana-empty-jokes";
const ANON_SKELETONS = 5;

const form = document.querySelector("#search-form");
const searchBtn = document.querySelector("#search-btn");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const clearSearchBtn = document.querySelector("#clear-search");
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
const unitButtons = document.querySelectorAll("[data-unit]");

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
let lastSearchQuery = "";
let lastSearchCoords = null;
let watchedStores = [];
let deferredInstall = null;
let distanceUnit = readUnit();

const DEFAULT_TITLE = document.title;

syncUnitToggle();
openOnlyEl.checked = readOpenOnly();
openOnlyEl.addEventListener("change", () => {
  try {
    localStorage.setItem(OPEN_ONLY_KEY, String(openOnlyEl.checked));
  } catch {
    /* private mode / blocked storage */
  }
  if (!lastResult) return;
  const openOnly = openOnlyEl.checked;
  const bananaChanged =
    hasVisibleBanana(lastResult, !openOnly) !== hasVisibleBanana(lastResult, openOnly);
  render(lastResult, { doCelebrate: bananaChanged });
});

unitButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setUnit(btn.dataset.unit);
  });
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

placeInput.addEventListener("input", syncClearButton);

clearSearchBtn?.addEventListener("click", () => {
  clearSearch();
  placeInput.focus();
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
    hideListUi();
    showStatus("Location was blocked. Search a postcode instead.");
  }
});

window.addEventListener("popstate", () => {
  const params = searchFromUrl();
  if (params?.q) {
    placeInput.value = params.q;
    runSearch(params, { updateUrl: false });
    return;
  }
  if (params?.lat != null) {
    placeInput.value = "";
    runSearch(params, { updateUrl: false, skipIntro: true });
    return;
  }
  placeInput.value = "";
  abortController?.abort();
  setSearching(false);
  clearResults();
  syncClearButton();
});

summaryEl.addEventListener("click", onShareClick);
spotlightEl.addEventListener("click", onResultsClick);
resultsEl.addEventListener("click", onResultsClick);
watchListEl.addEventListener("click", onResultsClick);

const initialSearch = searchFromUrl();
if (initialSearch?.q) {
  placeInput.value = initialSearch.q;
  runSearch(initialSearch, { updateUrl: false });
} else if (initialSearch?.lat != null) {
  runSearch(initialSearch, { updateUrl: false, skipIntro: true });
} else {
  syncClearButton();
}

async function runSearch(params, { skipIntro = false, updateUrl = true } = {}) {
  abortController?.abort();
  abortController = new AbortController();
  const { signal } = abortController;
  const seq = ++searchSeq;

  if (params.q) {
    lastSearchQuery = String(params.q).trim();
    lastSearchCoords = null;
  } else if (params.lat != null || params.lng != null) {
    lastSearchQuery = "";
    lastSearchCoords = {
      lat: Number(params.lat),
      lng: Number(params.lng),
    };
  }

  bananaEl.classList.remove("happy", "sad");
  radarEl.classList.remove("found", "miss");
  document.querySelector(".celebrate")?.remove();
  setSearching(true);
  if (updateUrl) syncSearchUrl(params);
  if (!skipIntro) beginSkeletonState();

  try {
    const data = await searchWithProgress(params, signal, (event) => {
      if (seq !== searchSeq) return;
      handleProgress(event);
    });
    if (seq !== searchSeq) return;
    render(data);
    syncClearButton();
  } catch (err) {
    if (err?.name === "AbortError" || seq !== searchSeq) return;
    setSearching(false);
    hideListUi();
    syncDocumentTitle(null);
    showStatus(searchErrorMessage(err));
    syncClearButton();
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
  throw new Error(data.error || "Couldn't complete that search.");
}

async function fetchJsonSearch(query, signal) {
  let res;
  try {
    res = await fetch(`/api/search?${query}`, { signal });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new Error(
      "Couldn't reach Banana Radar. Check your connection and try again."
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Couldn't complete that search.");
  }
  return data;
}

function searchErrorMessage(err) {
  const msg = String(err?.message || "");
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Couldn't reach Banana Radar. Check your connection and try again.";
  }
  if (/unexpected token|is not valid json|json\.parse/i.test(msg)) {
    return "Couldn't complete that search. Try again in a moment.";
  }
  if (/^request failed \(\d+\)$/i.test(msg) || msg === "Search failed") {
    return "Couldn't complete that search. Try a postcode or place name again.";
  }
  return msg || "Something went banana-shaped.";
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
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error("Couldn't complete that search. Try again in a moment.");
      }
      if (event.type === "error") {
        throw new Error(event.error || "Couldn't complete that search.");
      }
      onEvent(event);
      if (event.type === "done") result = event;
    }
  }

  const leftover = buffer.trim();
  if (leftover) {
    let event;
    try {
      event = JSON.parse(leftover);
    } catch {
      throw new Error("Couldn't complete that search. Try again in a moment.");
    }
    if (event.type === "error") {
      throw new Error(event.error || "Couldn't complete that search.");
    }
    onEvent(event);
    if (event.type === "done") result = event;
  }

  if (!result) throw new Error("Search ended before any stores came back.");
  return result;
}

function handleProgress(event) {
  if (event.type === "origin") {
    const label = event.origin?.label || "your area";
    showStatus(`Found ${label}. Looking up nearby stores…`);
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
    showStatus("Checking live Starbucks menus…");
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
      `Checking live menus… ${filled.length} of ${cards.length} stores`
    );
  }
}

function beginSkeletonState(status = "Finding nearby Starbucks…") {
  showStatus(status);
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

function hasVisibleBanana(data, openOnly) {
  const stores = data?.stores || [];
  const visible = openOnly ? stores.filter((store) => store.isOpen) : stores;
  return visible.some((store) => store.flavourInStock);
}

function resultView(data) {
  const stores = data?.stores || [];
  const ranked = sortInStockFirst(stores);
  const visible = openOnlyEl.checked
    ? ranked.filter((store) => store.isOpen)
    : ranked;
  const hiddenClosed = stores.length - visible.length;
  const hits = visible.filter((store) => store.flavourInStock).length;
  const closedHits = stores.filter(
    (store) => store.flavourInStock && !store.isOpen
  ).length;
  const label = data?.origin?.label ? ` near ${data.origin.label}` : "";
  const title = headline(hits, visible.length, {
    closedHits,
    noneVisible: visible.length === 0,
  });
  const score = visible.length ? `${hits}/${visible.length}` : "0";
  const nearestHit = visible.find((store) => store.flavourInStock);
  return {
    stores,
    ranked,
    visible,
    hiddenClosed,
    hits,
    closedHits,
    label,
    title,
    score,
    nearestHit,
    origin: data?.origin?.label || "",
    checkedAt: formatCheckedAt(data?.checkedAt),
  };
}

function render(data, { doCelebrate = true } = {}) {
  lastResult = data;
  setSearching(false);
  const view = resultView(data);
  if (!view.stores.length) {
    hideListUi();
    syncDocumentTitle(null);
    showStatus("No Starbucks found nearby. Try a broader place name.");
    return;
  }

  const emptyJoke =
    view.hits === 0
      ? doCelebrate
        ? nextEmptyHeadline()
        : lastEmptyJoke || nextEmptyHeadline()
      : "";
  lastEmptyJoke = emptyJoke;
  const useJokeTitle = view.hits === 0 && view.title === "No banana nearby.";
  const cardTitle = useJokeTitle ? emptyJoke || view.title : view.title;
  const cardBody = summaryCopy(
    view.hits,
    view.visible.length,
    view.stores.length,
    view.label,
    openOnlyEl.checked
  );
  hideStatus();
  syncDocumentTitle(view);

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card${view.hits ? " hit" : ""} is-ready">
      <div>
        <h2>${escapeHtml(cardTitle)}</h2>
        <p>${escapeHtml(cardBody)}</p>
        ${view.checkedAt ? `<p class="checked-at">${escapeHtml(view.checkedAt)}</p>` : ""}
        <button type="button" class="btn ghost share-btn" data-share="summary">
          Share
        </button>
      </div>
      <div class="score">${escapeHtml(view.score)}</div>
    </div>
  `;

  toolbarEl.hidden = false;
  filterNoteEl.textContent =
    openOnlyEl.checked && view.hiddenClosed
      ? `${view.hiddenClosed} closed ${view.hiddenClosed === 1 ? "store" : "stores"} hidden`
      : "";

  if (view.nearestHit) {
    spotlightEl.hidden = false;
    spotlightEl.innerHTML = spotlightCard(view.nearestHit, view.hits);
  } else {
    spotlightEl.hidden = true;
    spotlightEl.innerHTML = "";
  }

  const rest = view.nearestHit
    ? view.visible.filter((store) => storeKey(store) !== storeKey(view.nearestHit))
    : view.visible;

  resultsEl.removeAttribute("aria-busy");
  if (!rest.length) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = view.visible.length
      ? ""
      : `<p class="empty">All nearby stores are closed. Turn off Open only to see them.</p>`;
  } else {
    resultsEl.hidden = false;
    resultsEl.innerHTML =
      (view.nearestHit ? `<p class="results-label">Other nearby stores</p>` : "") +
      rest.map((store, index) => storeCard(store, { filled: true, index })).join("");
  }

  if (doCelebrate && view.hits > 0) celebrate();
  else if (doCelebrate) lament();
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
  syncDocumentTitle(null);
}

function clearSearch() {
  abortController?.abort();
  placeInput.value = "";
  lastSearchQuery = "";
  lastSearchCoords = null;
  lastResult = null;
  lastEmptyJoke = "";
  setSearching(false);
  clearResults();
  syncSearchUrl({});
  syncClearButton();
}

function syncClearButton() {
  if (!clearSearchBtn) return;
  clearSearchBtn.hidden = !(
    placeInput.value.trim() ||
    lastResult ||
    searchFromUrl()
  );
}

function searchFromUrl() {
  const params = new URLSearchParams(location.search);
  const q = params.get("q")?.trim();
  if (q) return { q };
  if (!params.has("lat") || !params.has("lng")) return null;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function queryFromUrl() {
  return searchFromUrl()?.q || "";
}

function syncSearchUrl(params = {}) {
  const nextParams = new URLSearchParams();
  const q = String(params.q || "").trim();
  if (q) {
    nextParams.set("q", q);
  } else {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      nextParams.set("lat", String(lat));
      nextParams.set("lng", String(lng));
    }
  }
  const qs = nextParams.toString();
  const next = qs ? `${location.pathname}?${qs}` : location.pathname;
  const current = `${location.pathname}${location.search}`;
  if (current === next) return;
  history.pushState(qs ? Object.fromEntries(nextParams) : {}, "", next);
}

function syncDocumentTitle(view) {
  if (!view?.stores?.length) {
    document.title = DEFAULT_TITLE;
    return;
  }
  const place =
    view.origin && !/^your location$/i.test(view.origin) ? view.origin : "";
  if (view.hits > 0) {
    document.title = place
      ? `Banana on near ${place} — Banana Radar`
      : "Banana spotted nearby — Banana Radar";
    return;
  }
  document.title = place
    ? `No banana near ${place} — Banana Radar`
    : "No banana nearby — Banana Radar";
}

function headline(hits, total, { closedHits = 0, noneVisible = false } = {}) {
  if (noneVisible) return "Everyone's closed.";
  if (hits === 0 && closedHits > 0) {
    return "Banana's on — but those stores are closed.";
  }
  if (hits === 0) return "No banana nearby.";
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
            ${formatDistance(store.distanceKm)}
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
            ${formatDistance(store.distanceKm)}
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
        <button type="button" class="share-link" data-share="store" data-store-number="${escapeHtml(store.storeNumber)}">
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
            ${formatDistance(store.distanceKm)}
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
        <button type="button" class="share-link" data-share="store" data-store-number="${escapeHtml(store.storeNumber)}">
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
      data-store-postal="${escapeHtml(store.address?.postalCode || "")}"
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
    .map((item) => {
      const state = item.inStock ? "In stock" : "Sold out";
      return `
        <span class="chip" aria-label="${escapeHtml(item.name)}: ${state}">
          <span class="dot ${item.inStock ? "ok" : ""}" aria-hidden="true"></span>
          <span class="chip-name">${escapeHtml(item.name)}</span>
          <span class="chip-state${item.inStock ? " ok" : ""}">${state}</span>
        </span>`;
    })
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

function formatDistance(km) {
  if (!Number.isFinite(km)) return "";
  if (distanceUnit === "mi") {
    const miles = km * 0.621371;
    if (miles < 0.06) return "Right by you";
    if (miles < 0.2) return `${Math.round(miles * 5280)} ft`;
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
  }
  if (km < 0.1) return "Right by you";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function readUnit() {
  try {
    const saved = localStorage.getItem(UNIT_KEY);
    if (saved === "mi" || saved === "km") return saved;
  } catch {
    /* private mode / blocked storage */
  }
  return "km";
}

function setUnit(unit) {
  if (unit !== "km" && unit !== "mi") return;
  if (unit === distanceUnit) return;
  distanceUnit = unit;
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    /* ignore */
  }
  syncUnitToggle();
  if (lastResult) render(lastResult, { doCelebrate: false });
}

function syncUnitToggle() {
  unitButtons.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.unit === distanceUnit));
  });
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
  const distance = formatDistance(store.distanceKm);
  const where = distance ? `${store.name} (${distance})` : store.name;
  if (store.flavourInStock) return `Banana's on at ${where}`;
  if (store.status === "sold_out") return `Banana's sold out at ${where}`;
  return `Can't tell if banana's on at ${where}`;
}

function summaryShareText() {
  if (!lastResult) return "Banana Radar";
  const view = resultView(lastResult);
  if (view.hits === 0) {
    const joke = (lastEmptyJoke || "It's a sad banana day.").replace(/\.$/, "");
    return `${joke}${view.label} — none of the ${view.visible.length || view.stores.length} nearby stores have the banana flavour.`;
  }
  const body = summaryCopy(
    view.hits,
    view.visible.length,
    view.stores.length,
    view.label,
    openOnlyEl.checked
  );
  return `${view.title} ${body}`;
}

function withShareLink(text, target) {
  const link = shareSearchUrl(target);
  return link ? `${text}\n${link}` : text;
}

function shareSearchUrl(target) {
  if (!target) return "";
  const spec = typeof target === "string" ? { q: target } : target;
  const url = new URL(location.pathname, location.origin);
  const q = String(spec.q || "").trim();
  if (q) {
    url.searchParams.set("q", q);
    return url.toString();
  }
  const lat = Number(spec.lat);
  const lng = Number(spec.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
    return url.toString();
  }
  return "";
}

function summaryShareTarget() {
  if (lastSearchQuery) return { q: lastSearchQuery };
  const origin = lastResult?.origin;
  if (origin?.label && !/^your location$/i.test(origin.label)) {
    return { q: origin.label };
  }
  const postcode = storeSearchQuery(lastResult?.stores?.[0]);
  if (postcode) return { q: postcode };
  if (
    lastSearchCoords &&
    Number.isFinite(lastSearchCoords.lat) &&
    Number.isFinite(lastSearchCoords.lng)
  ) {
    return lastSearchCoords;
  }
  if (Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng)) {
    return { lat: origin.lat, lng: origin.lng };
  }
  return null;
}

function storeSearchQuery(store) {
  const postcode = String(store?.address?.postalCode || "").trim();
  if (postcode) return postcode;
  const city = String(store?.address?.city || "").trim();
  if (city) return city;
  return lastSearchQuery || "";
}

function onShareClick(event) {
  const btn = event.target.closest("[data-share]");
  if (!btn) return;
  shareOrCopy(btn);
}

async function shareOrCopy(button) {
  const text = shareTextFromButton(button);
  const spec = shareSpecFromButton(button);
  let file = null;
  try {
    if (spec) file = makeShareFile(spec);
  } catch {
    file = null;
  }
  const title = "Banana Radar";
  const withFile = file ? { title, text, files: [file] } : null;
  const textOnly = { title, text };

  try {
    if (typeof navigator.share === "function") {
      if (withFile && navigator.canShare?.(withFile)) {
        try {
          await navigator.share(withFile);
          return;
        } catch (err) {
          if (err?.name === "AbortError") return;
        }
      }
      if (!navigator.canShare || navigator.canShare(textOnly)) {
        await navigator.share(textOnly);
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

function shareTextFromButton(button) {
  if (button.dataset.share === "store") {
    const store = lastResult?.stores?.find(
      (item) => String(item.storeNumber) === String(button.dataset.storeNumber)
    );
    if (store) return withShareLink(shareLine(store), storeSearchQuery(store));
  }
  return withShareLink(summaryShareText(), summaryShareTarget());
}

function shareSpecFromButton(button) {
  if (button.dataset.share === "store") {
    const store = lastResult?.stores?.find(
      (item) => String(item.storeNumber) === String(button.dataset.storeNumber)
    );
    return store ? storeShareSpec(store) : summaryShareSpec();
  }
  return summaryShareSpec();
}

function summaryShareSpec() {
  if (!lastResult) return null;
  const view = resultView(lastResult);
  const fact = summaryCopy(
    view.hits,
    view.visible.length,
    view.stores.length,
    view.label,
    openOnlyEl.checked
  );
  const joke = view.hits === 0 && view.title === "No banana nearby." ? lastEmptyJoke : "";
  return {
    mood: view.hits ? "hit" : "miss",
    kicker: view.origin ? `Near ${view.origin}` : "Live menu check",
    title: joke || view.title,
    body: fact,
    score: view.score,
    slug: joke || view.title,
  };
}

function storeShareSpec(store) {
  const inStock = (store.items || [])
    .filter((item) => item.inStock)
    .map((item) => item.name);
  return {
    mood: store.flavourInStock ? "hit" : "miss",
    kicker: STATUS_COPY[store.status] || STATUS_COPY.unknown,
    title: store.name,
    body: [
      formatDistance(store.distanceKm),
      store.isOpen ? "Open" : "Closed",
      store.hoursLabel,
    ]
      .filter(Boolean)
      .join(" · "),
    detail: store.address?.singleLine || "",
    chips: (inStock.length ? inStock : (store.items || []).map((item) => item.name)).slice(
      0,
      3
    ),
    score: "",
    slug: store.name,
  };
}

const SHARE_W = 1200;
const SHARE_H = 630;

function makeShareFile(spec) {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  drawShareCard(ctx, spec);
  const dataUrl = canvas.toDataURL("image/png");
  const bytes = atob(dataUrl.split(",")[1]);
  const data = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) data[i] = bytes.charCodeAt(i);
  return new File([data], `banana-radar-${slugify(spec.slug)}.png`, {
    type: "image/png",
  });
}

function slugify(value) {
  return (
    String(value || "card")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "card"
  );
}

function drawShareCard(ctx, spec) {
  const hit = spec.mood === "hit";
  ctx.fillStyle = "#fff6df";
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  const bananaGlow = ctx.createRadialGradient(180, 40, 20, 180, 40, 520);
  bananaGlow.addColorStop(0, "rgba(246, 195, 67, 0.5)");
  bananaGlow.addColorStop(1, "rgba(246, 195, 67, 0)");
  ctx.fillStyle = bananaGlow;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  const greenGlow = ctx.createRadialGradient(1120, 80, 10, 1120, 80, 420);
  greenGlow.addColorStop(0, "rgba(0, 117, 74, 0.2)");
  greenGlow.addColorStop(1, "rgba(0, 117, 74, 0)");
  ctx.fillStyle = greenGlow;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  ctx.save();
  ctx.shadowColor = "rgba(30, 57, 50, 0.2)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = "#1e3932";
  ctx.beginPath();
  ctx.roundRect(48, 48, 1104, 534, 36);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(96, 100, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#fff6df";
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "#f6c343";
  ctx.stroke();

  ctx.font = "700 20px Outfit, system-ui, sans-serif";
  ctx.fillStyle = "#fff6df";
  ctx.fillText("Banana Radar", 118, 107);

  ctx.font = "700 15px Outfit, system-ui, sans-serif";
  ctx.fillStyle = "#f6c343";
  ctx.fillText(
    ellipsis(ctx, String(spec.kicker || "").toUpperCase(), 640),
    80,
    168
  );

  const textMax = 640;
  ctx.fillStyle = "#fff6df";
  const title = fitHeadline(ctx, spec.title, textMax, 3);
  let y = 188;
  for (const line of title.lines) {
    y += title.size * 1.08;
    ctx.font = `700 ${title.size}px Fraunces, Georgia, serif`;
    ctx.fillText(line, 80, y);
  }

  ctx.font = "500 26px Outfit, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 246, 223, 0.78)";
  const bodyLines = wrapLines(ctx, spec.body, textMax, spec.chips?.length ? 2 : 3);
  y += 28;
  for (const line of bodyLines) {
    y += 34;
    ctx.fillText(line, 80, y);
  }

  if (spec.detail && y < 470) {
    ctx.font = "500 22px Outfit, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255, 246, 223, 0.5)";
    y += 32;
    ctx.fillText(ellipsis(ctx, spec.detail, textMax), 80, y);
  }

  if (spec.chips?.length && y < 470) {
    y += 28;
    let x = 80;
    ctx.font = "600 18px Outfit, system-ui, sans-serif";
    for (const chip of spec.chips) {
      const label = ellipsis(ctx, chip, 260);
      const width = Math.min(280, ctx.measureText(label).width + 36);
      if (x + width > 720) break;
      ctx.fillStyle = "rgba(255, 246, 223, 0.12)";
      ctx.beginPath();
      ctx.roundRect(x, y, width, 36, 18);
      ctx.fill();
      ctx.fillStyle = "#fff6df";
      ctx.fillText(label, x + 18, y + 24);
      x += width + 10;
    }
  }

  if (spec.score) {
    ctx.font = "700 72px Fraunces, Georgia, serif";
    ctx.fillStyle = "#f6c343";
    ctx.textAlign = "right";
    ctx.fillText(spec.score, 1112, 538);
    ctx.textAlign = "left";
  }

  drawShareBanana(ctx, hit);

  ctx.font = "600 18px Outfit, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 246, 223, 0.42)";
  ctx.fillText("banana.itsnoahevans.co.uk", 80, 548);
}

function fitHeadline(ctx, text, maxWidth, maxLines) {
  for (const size of [58, 50, 44, 38]) {
    ctx.font = `700 ${size}px Fraunces, Georgia, serif`;
    const lines = wrapLines(ctx, text, maxWidth, maxLines);
    const clipped = lines[lines.length - 1]?.endsWith("…");
    if (!clipped || size === 38) return { size, lines };
  }
  return { size: 38, lines: wrapLines(ctx, text, maxWidth, maxLines) };
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[i];
    if (lines.length === maxLines - 1) {
      lines.push(ellipsis(ctx, [current, ...words.slice(i + 1)].join(" "), maxWidth));
      return lines;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function ellipsis(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function drawShareBanana(ctx, hit) {
  ctx.save();
  ctx.translate(930, 318);
  ctx.strokeStyle = hit ? "rgba(246, 195, 67, 0.28)" : "rgba(255, 246, 223, 0.14)";
  for (const [radius, width] of [
    [78, 3],
    [118, 3],
    [158, 2.5],
    [198, 2],
  ]) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const size = 268;
  const x = 796;
  const y = 184;
  if (bananaEl?.complete && bananaEl.naturalWidth) {
    ctx.save();
    if (!hit) ctx.filter = "grayscale(0.32) saturate(0.7)";
    ctx.drawImage(bananaEl, x, y, size, size);
    ctx.restore();
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

const CONFETTI_KINDS = ["dot", "chip", "ribbon"];
const CONFETTI_COLORS = ["#f6c343", "#e09412", "#00754a", "#1e3932", "#fff6df", "#ffe08a"];
const CELEBRATE_MS = 2800;

function resetBananaMood() {
  bananaEl.classList.remove("happy", "sad");
  radarEl.classList.remove("found", "miss");
}

function celebrate() {
  if (reducedMotion.matches) return;

  resetBananaMood();
  void bananaEl.offsetWidth;
  bananaEl.classList.add("happy");
  radarEl.classList.add("found");

  burstBananas();

  window.clearTimeout(celebrateTimer);
  celebrateTimer = window.setTimeout(resetBananaMood, CELEBRATE_MS);
}

function lament() {
  if (reducedMotion.matches) return;

  resetBananaMood();
  void bananaEl.offsetWidth;
  bananaEl.classList.add("sad");
  radarEl.classList.add("miss");

  burstSadBananas();

  window.clearTimeout(celebrateTimer);
  celebrateTimer = window.setTimeout(resetBananaMood, CELEBRATE_MS);
}

function bananaClone() {
  const svg = bananaEl.cloneNode(true);
  svg.removeAttribute("role");
  svg.removeAttribute("aria-label");
  svg.setAttribute("aria-hidden", "true");
  svg.className = "";
  return svg;
}

function fxLayer() {
  document.querySelector(".celebrate")?.remove();
  const layer = document.createElement("div");
  layer.className = "celebrate";
  layer.setAttribute("aria-hidden", "true");
  return layer;
}

function burstBananas() {
  const layer = fxLayer();
  const origin = bananaEl.getBoundingClientRect();
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;

  addFlyers(layer);
  addConfetti(layer, cx, cy);
  addNiblets(layer, cx, cy);

  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), CELEBRATE_MS);
}

function burstSadBananas() {
  const layer = fxLayer();
  const origin = bananaEl.getBoundingClientRect();

  addSadCloud(layer, origin);
  addRain(layer, origin);
  addSadFlyers(layer);

  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), CELEBRATE_MS);
}

function flyerPath(edge) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (edge === 0) {
    return {
      x: Math.random() * w,
      y: -48,
      dx: (Math.random() * 2 - 1) * w * 0.55,
      dy: h * (0.5 + Math.random() * 0.65),
    };
  }
  if (edge === 1) {
    return {
      x: -48,
      y: Math.random() * h * 0.85,
      dx: w * (0.5 + Math.random() * 0.6),
      dy: (Math.random() * 2 - 1) * h * 0.55,
    };
  }
  if (edge === 2) {
    return {
      x: w + 48,
      y: Math.random() * h * 0.85,
      dx: -w * (0.5 + Math.random() * 0.6),
      dy: (Math.random() * 2 - 1) * h * 0.55,
    };
  }
  return {
    x: Math.random() * w,
    y: Math.random() * h * 0.28,
    dx: (Math.random() * 2 - 1) * w * 0.7,
    dy: h * (0.35 + Math.random() * 0.55),
  };
}

function addFlyers(layer) {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const path = flyerPath(i % 4);
    const flyer = document.createElement("div");
    flyer.className = "celebrate-flyer";
    flyer.style.setProperty("--x", `${path.x}px`);
    flyer.style.setProperty("--y", `${path.y}px`);
    flyer.style.setProperty("--dx", `${path.dx}px`);
    flyer.style.setProperty("--dy", `${path.dy}px`);
    flyer.style.setProperty("--sway", `${(Math.random() * 2 - 1) * 120}px`);
    flyer.style.setProperty("--spin", `${(Math.random() * 2 - 1) * 420}deg`);
    flyer.style.setProperty("--size", `${76 + Math.random() * 44}px`);
    flyer.style.setProperty("--dur", `${1600 + Math.random() * 700}ms`);
    flyer.style.setProperty(
      "--delay",
      `${i < 7 ? Math.random() * 140 : 920 + Math.random() * 180}ms`
    );
    const svg = bananaClone();
    svg.className = "celebrate-flyer-svg";
    flyer.appendChild(svg);
    layer.appendChild(flyer);
  }
}

function addConfetti(layer, cx, cy) {
  for (let i = 0; i < 26; i++) {
    spawnConfetti(layer, {
      kind: CONFETTI_KINDS[i % 3],
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      x: cx,
      y: cy,
      dx: Math.cos(Math.random() * Math.PI * 2) * (70 + Math.random() * 160),
      up: -(40 + Math.random() * 90),
      dy: 110 + Math.random() * 180,
      rot: (Math.random() * 2 - 1) * 540,
      delay: Math.random() * 80,
      dur: 1200 + Math.random() * 500,
    });
  }

  for (let i = 0; i < 14; i++) {
    spawnConfetti(layer, {
      kind: CONFETTI_KINDS[i % 3],
      color: CONFETTI_COLORS[(i + 3) % CONFETTI_COLORS.length],
      x: Math.random() * window.innerWidth,
      y: -16,
      dx: (Math.random() * 2 - 1) * 50,
      dy: 180 + Math.random() * 240,
      rot: (Math.random() * 2 - 1) * 420,
      delay: 180 + Math.random() * 1100,
      dur: 1500 + Math.random() * 700,
      fall: true,
    });
  }

  for (let i = 0; i < 12; i++) {
    spawnConfetti(layer, {
      kind: CONFETTI_KINDS[i % 3],
      color: CONFETTI_COLORS[(i + 1) % CONFETTI_COLORS.length],
      x: cx,
      y: cy,
      dx: Math.cos(Math.random() * Math.PI * 2) * (50 + Math.random() * 140),
      up: -(30 + Math.random() * 70),
      dy: 100 + Math.random() * 160,
      rot: (Math.random() * 2 - 1) * 480,
      delay: 980 + Math.random() * 140,
      dur: 1100 + Math.random() * 500,
    });
  }
}

function spawnConfetti(layer, spec) {
  const piece = document.createElement("span");
  piece.className = `celebrate-piece confetti-${spec.kind}${spec.fall ? " fall" : ""}`;
  piece.style.background = spec.color;
  piece.style.setProperty("--x", `${spec.x}px`);
  piece.style.setProperty("--y", `${spec.y}px`);
  piece.style.setProperty("--dx", `${spec.dx}px`);
  if (spec.up != null) piece.style.setProperty("--up", `${spec.up}px`);
  piece.style.setProperty("--dy", `${spec.dy}px`);
  piece.style.setProperty("--rot", `${spec.rot}deg`);
  piece.style.setProperty("--delay", `${spec.delay}ms`);
  piece.style.setProperty("--dur", `${spec.dur}ms`);
  layer.appendChild(piece);
}

function addNiblets(layer, cx, cy) {
  addNibletWave(layer, cx, cy, 6, 0);
  addNibletWave(layer, cx, cy, 4, 980);
}

function addNibletWave(layer, cx, cy, count, delay) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "celebrate-piece celebrate-niblet";
    const svg = bananaClone();
    svg.className = "celebrate-niblet-svg";
    el.appendChild(svg);

    const size = 20 + Math.random() * 10;
    const angle = -Math.PI / 2 + (i - (count - 1) / 2) * 0.55 + (Math.random() * 0.18 - 0.09);
    const dist = 100 + Math.random() * 90;
    el.style.setProperty("--size", `${size}px`);
    el.style.setProperty("--x", `${cx - size / 2}px`);
    el.style.setProperty("--y", `${cy - size / 2}px`);
    el.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    el.style.setProperty("--up", `${-(50 + Math.random() * 40)}px`);
    el.style.setProperty("--dy", `${90 + Math.random() * 110}px`);
    el.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 420}deg`);
    el.style.setProperty("--delay", `${delay + i * 32}ms`);
    el.style.setProperty("--dur", `${1100 + Math.random() * 320}ms`);
    layer.appendChild(el);
  }
}

function addSadCloud(layer, origin) {
  const cloud = document.createElement("div");
  cloud.className = "sad-cloud";
  cloud.style.setProperty("--tx", `${origin.left + origin.width / 2}px`);
  cloud.style.setProperty("--ty", `${origin.top - 6}px`);
  cloud.innerHTML = `<svg class="sad-cloud-svg" viewBox="0 0 64 36" aria-hidden="true">
      <ellipse cx="22" cy="22" rx="14" ry="10" fill="#9aa7b2"/>
      <ellipse cx="36" cy="18" rx="16" ry="12" fill="#c5ced6"/>
      <ellipse cx="48" cy="23" rx="11" ry="9" fill="#a8b3be"/>
    </svg>`;
  layer.appendChild(cloud);
}

function addRain(layer, origin) {
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + 4;
  for (let i = 0; i < 16; i++) {
    const drop = document.createElement("span");
    drop.className = "sad-drop";
    drop.style.setProperty("--x", `${cx + (i % 8 - 3.5) * 9 + (Math.random() * 8 - 4)}px`);
    drop.style.setProperty("--y", `${cy}px`);
    drop.style.setProperty("--dx", `${(Math.random() * 2 - 1) * 12}px`);
    drop.style.setProperty("--dy", `${80 + Math.random() * 90}px`);
    drop.style.setProperty("--delay", `${60 + i * 90}ms`);
    drop.style.setProperty("--dur", `${900 + Math.random() * 280}ms`);
    layer.appendChild(drop);
  }
}

function addSadFlyers(layer) {
  const specs = [
    { x: 16, y: 12, drift: -10, spin: -48, size: 44, dur: 2100, delay: 0 },
    { x: 64, y: 18, drift: 12, spin: 36, size: 34, dur: 1960, delay: 140 },
    { x: 40, y: 6, drift: 4, spin: -22, size: 38, dur: 2200, delay: 40 },
    { x: 26, y: 10, drift: -8, spin: 30, size: 40, dur: 2000, delay: 960 },
    { x: 72, y: 20, drift: 10, spin: -40, size: 32, dur: 1880, delay: 1080 },
  ];

  for (const spec of specs) {
    const flyer = document.createElement("div");
    flyer.className = "celebrate-flyer is-sad";
    flyer.style.setProperty("--x", `${spec.x}vw`);
    flyer.style.setProperty("--y", `${spec.y}vh`);
    flyer.style.setProperty("--drift", `${spec.drift}vw`);
    flyer.style.setProperty("--spin", `${spec.spin}deg`);
    flyer.style.setProperty("--size", `${spec.size}px`);
    flyer.style.setProperty("--dur", `${spec.dur}ms`);
    flyer.style.setProperty("--delay", `${spec.delay}ms`);
    const svg = bananaClone();
    svg.className = "celebrate-flyer-svg";
    flyer.appendChild(svg);
    layer.appendChild(flyer);
  }
}

function showStatus(message) {
  statusEl.hidden = false;
  statusEl.textContent = message;
}

function hideStatus() {
  statusEl.hidden = true;
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
    postalCode: button.dataset.storePostal || "",
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
    setWatchStatus(err.message || "Couldn't update that watch.", { error: true });
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
  const iosNeedsInstall = isIos() && !isStandalone();
  watchesEl.hidden =
    !hasWatches && !watchStatusEl?.textContent && !iosNeedsInstall;
  if (watchHintEl) {
    if (iosNeedsInstall) {
      watchHintEl.textContent = hasWatches
        ? "We'll ping this device when banana flavour comes back at these stores."
        : "On iPhone, add Banana Radar to your Home Screen first (Share → Add to Home Screen), then tap Notify me on a store.";
    } else {
      watchHintEl.textContent = hasWatches
        ? "We'll ping this device when banana flavour comes back at these stores."
        : "Tap Notify me on a store to watch it. No account.";
    }
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

function setWatchStatus(message, { error = false } = {}) {
  if (!watchStatusEl) return;
  watchStatusEl.hidden = !message;
  watchStatusEl.textContent = message || "";
  watchStatusEl.classList.toggle("is-error", Boolean(message) && error);
  watchStatusEl.classList.toggle("is-ok", Boolean(message) && !error);
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
} else {
  renderWatchList();
}

renderWatchList();

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
