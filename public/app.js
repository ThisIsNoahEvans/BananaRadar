const form = document.querySelector("#search-form");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const filtersEl = document.querySelector("#filters");
const resultsEl = document.querySelector("#results");
const radarEl = document.querySelector(".radar");
const bananaEl = document.querySelector(".banana");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let celebrateTimer = 0;
const watchesEl = document.querySelector("#watches");
const watchListEl = document.querySelector("#watch-list");
const watchHintEl = document.querySelector("#watch-hint");
const watchStatusEl = document.querySelector("#watch-status");
const installBtn = document.querySelector("#install");

const STATUS_COPY = {
  in_stock: "Banana's on",
  sold_out: "Sold out",
  unknown: "Can't tell",
};

let itemFilter = "both";
let lastResult = null;
let watchedStores = [];
let deferredInstall = null;

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

summaryEl.addEventListener("click", onShareClick);
resultsEl.addEventListener("click", onResultsClick);
watchListEl.addEventListener("click", onResultsClick);

filtersEl.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-kind]");
  if (!btn) return;
  itemFilter = btn.dataset.kind;
  syncFilterButtons();
  if (lastResult) renderResults(lastResult);
});

async function runSearch(params) {
  bananaEl.classList.remove("happy");
  radarEl.classList.remove("found");
  document.querySelector(".celebrate")?.remove();
  showStatus("Checking live Starbucks menus… this takes a few seconds.");
  summaryEl.hidden = true;
  filtersEl.hidden = true;
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
    filtersEl.hidden = true;
    showStatus("No Starbucks found nearby. Try a broader place name.");
    return;
  }

  const hits = data.summary?.flavourInStock || 0;
  const label = data.origin?.label ? ` near ${data.origin.label}` : "";
  const nearestHit = stores.find((store) => store.flavourInStock);
  const shareText = nearestHit
    ? shareLine(nearestHit)
    : `It's a sad banana day${label} — none of the ${stores.length} nearby stores have the banana flavour.`;
  statusEl.hidden = true;

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="summary-card${hits ? " hit" : ""}">
      <div>
        <h2>${headline(hits, stores.length)}</h2>
        <p>${hits} of ${stores.length} nearby stores have the banana flavour on the menu${label}.</p>
        <button type="button" class="btn ghost share-btn" data-share-text="${escapeHtml(shareText)}">
          Share
        </button>
      </div>
      <div class="score">${hits}/${stores.length}</div>
    </div>
  `;

  filtersEl.hidden = false;
  syncFilterButtons();
  renderResults(data);

  if (hits > 0) celebrate();
}

function renderResults(data) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = (data.stores || []).map(storeCard).join("");
}

function syncFilterButtons() {
  filtersEl.querySelectorAll("[data-kind]").forEach((btn) => {
    const active = btn.dataset.kind === itemFilter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
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
  const drinks = store.drinks || itemsOfKind(store, "drink");
  const food = store.food || itemsOfKind(store, "food");

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
      ${itemGroups(drinks, food)}
      <div class="card-links">
        <a href="${maps}" target="_blank" rel="noreferrer">Directions</a>
        <a href="${sbux}" target="_blank" rel="noreferrer">Starbucks page</a>
        <button type="button" class="share-link" data-share-text="${escapeHtml(shareLine(store))}">
          Share
        </button>
        <button
          type="button"
          class="watch-link${isWatched(store.storeNumber) ? " is-watching" : ""}"
          data-watch="toggle"
          data-store-number="${escapeHtml(store.storeNumber)}"
          data-store-name="${escapeHtml(store.name)}"
          data-store-market="${escapeHtml(store.market)}"
          data-store-country="${escapeHtml(store.address.countryCode || "")}"
        >
          ${isWatched(store.storeNumber) ? "Watching" : "Notify me"}
        </button>
      </div>
    </article>
  `;
}

function itemsOfKind(store, kind) {
  return (store.items || []).filter((item) => item.kind === kind);
}

function itemGroups(drinks, food) {
  const showDrinks = itemFilter !== "food";
  const showFood = itemFilter !== "drinks";

  if (showDrinks && showFood && !drinks.length && !food.length) {
    return `<div class="items">
      <span class="chip">No live banana items on this store’s published menu</span>
    </div>`;
  }

  return [
    showDrinks &&
      itemGroup("Drinks", drinks, "No banana drinks on this menu"),
    showFood && itemGroup("Food", food, "No banana food on this menu"),
  ]
    .filter(Boolean)
    .join("");
}

function itemGroup(label, items, emptyCopy) {
  const chips = items.length
    ? items.map(itemChip).join("")
    : `<span class="chip muted">${emptyCopy}</span>`;

  return `
    <div class="item-group">
      <h4 class="item-heading">${label}</h4>
      <div class="items">${chips}</div>
    </div>
  `;
}

function itemChip(item) {
  return `
    <span class="chip">
      <span class="dot ${item.inStock ? "ok" : ""}"></span>
      ${escapeHtml(item.name)}
    </span>`;
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 0.1) return "Right by you";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
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
    if (lastResult) renderResults(lastResult);
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
