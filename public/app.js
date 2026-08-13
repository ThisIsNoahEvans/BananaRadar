const form = document.querySelector("#search-form");
const locateBtn = document.querySelector("#locate");
const placeInput = document.querySelector("#place");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const spotlightEl = document.querySelector("#spotlight");
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

async function runSearch(params) {
  showStatus("Checking live Starbucks menus… this takes a few seconds.");
  summaryEl.hidden = true;
  spotlightEl.hidden = true;
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
    spotlightEl.hidden = true;
    spotlightEl.innerHTML = "";
    showStatus("No Starbucks found nearby. Try a broader place name.");
    return;
  }

  const hits = data.summary?.flavourInStock || 0;
  const label = data.origin?.label ? ` near ${data.origin.label}` : "";
  const nearestHit = stores.find((store) => store.flavourInStock);
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

  if (nearestHit) {
    spotlightEl.hidden = false;
    spotlightEl.innerHTML = spotlightCard(nearestHit, hits);
  } else {
    spotlightEl.hidden = true;
    spotlightEl.innerHTML = "";
  }

  const rest = nearestHit
    ? stores.filter((store) => store !== nearestHit)
    : stores;

  if (!rest.length) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.hidden = false;
  resultsEl.innerHTML =
    (nearestHit ? `<p class="results-label">Other nearby stores</p>` : "") +
    rest.map(storeCard).join("");
}

function headline(hits, total) {
  if (hits === 0) return "It's a sad banana day.";
  if (hits === total) return "The flavour is everywhere.";
  return "Banana spotted nearby.";
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
      </div>
    </article>
  `;
}

function storeCard(store) {
  const badge = STATUS_COPY[store.status] || STATUS_COPY.unknown;

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
        ${itemChips(store)}
      </div>
      <div class="card-links">
        <a href="${mapsUrl(store)}" target="_blank" rel="noreferrer">Directions</a>
        <a href="${starbucksUrl(store)}" target="_blank" rel="noreferrer">Starbucks page</a>
      </div>
    </article>
  `;
}

function itemChips(store) {
  const items = store.items || [];
  if (!items.length) {
    return `<span class="chip">No live banana items on this store’s published menu</span>`;
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
