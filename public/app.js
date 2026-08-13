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
  btn.addEventListener("click", () => {
    placeInput.value = btn.dataset.place;
    form.requestSubmit();
  });
});

summaryEl.addEventListener("click", onShareClick);
resultsEl.addEventListener("click", onShareClick);

async function runSearch(params) {
  showStatus("Checking live Starbucks menus… this takes a few seconds.");
  summaryEl.hidden = true;
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
  const stores = data.stores || [];
  if (!stores.length) {
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
    <div class="summary-card">
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
        <button type="button" class="share-link" data-share-text="${escapeHtml(shareLine(store))}">
          Share
        </button>
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
