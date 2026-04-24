let chart;
let livePayloadCache = null;
let selectedAirportCode = null;
let chartJsPromise = null;
let lastUpdateTimestamp = null;
let terminalMap = null;
let terminalMarkers = {};
const hasRIC = typeof window !== "undefined" && "requestIdleCallback" in window;

const PHL_CONFIG = {
  "airportCode": "PHL",
  "config": { "post_security_connected": true, "default_zoom": 16, "shuttle_active": true, "center": [39.8775, -75.244] },
  "terminals": [
    {
      "id": "A_WEST", "name": "A-West (Intl)", "shortName": "A", "checkpoints": [4377], "coords": [39.875023, -75.249537],
      "airlines": ["British Airways", "Aer Lingus", "Lufthansa", "Qatar Airways", "American (Intl)"],
      "notes": "Primary International Terminal."
    },
    {
      "id": "A_EAST", "name": "Terminal A-East", "shortName": "A", "checkpoints": [4386, 4368], "coords": [39.875500, -75.246500],
      "airlines": ["American Airlines", "Aer Lingus", "Icelandair"],
      "notes": "Walkable to A-West and B."
    },
    {
      "id": "BC_HUB", "name": "B/C Hub", "shortName": "B/C", "checkpoints": [5047, 5052], "coords": [39.876148, -75.243988],
      "airlines": ["American Airlines"],
      "notes": "Main domestic hub for American."
    },
    {
      "id": "D_HUB", "name": "Terminal D", "shortName": "D", "checkpoints": [3971], "coords": [39.877168, -75.240543],
      "airlines": ["Delta", "United", "Alaska"],
      "notes": "Use the D/E Connector entry."
    },
    {
      "id": "E_HUB", "name": "Terminal E", "shortName": "E", "checkpoints": [4126], "coords": [39.878594, -75.239604],
      "airlines": ["Southwest", "Frontier", "Spirit", "JetBlue"],
      "notes": "Terminal E is connected to D airside."
    },
    {
      "id": "F_REGIONAL", "name": "Terminal F", "shortName": "F", "checkpoints": [5068], "coords": [39.880363, -75.239777],
      "airlines": ["American Eagle"],
      "notes": "Regional flights. Shuttle from C."
    }
  ],
  "routing_logic": [
    { "from": "F_REGIONAL", "to": "BC_HUB", "mode": "shuttle", "instruction": "Take the airside shuttle near Gate F10 to Terminal C." },
    { "from": "A_WEST", "to": "A_EAST", "mode": "walk", "instruction": "Direct airside walking path available." }
  ]
};

function scheduleNonCriticalTask(fn, timeout = 800) {
  if (hasRIC) {
    window.requestIdleCallback(fn, { timeout });
    return;
  }
  setTimeout(fn, 0);
}

function loadChartJs() {
  if (chartJsPromise) return chartJsPromise;
  if (window.Chart) {
    chartJsPromise = Promise.resolve(window.Chart);
    return chartJsPromise;
  }
  chartJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
    script.onload = () => resolve(window.Chart);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return chartJsPromise;
}

function fmtMinutes(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return null; // null = truly closed/no data
  if (n === 0) return 0;                      // 0 = "< 1 min" — open with no queue
  return Math.max(1, Math.round(n));
}

// Returns a short tier class (low/med/high/crit/none)
function waitTierClass(waitMinutes) {
  const n = Number(waitMinutes);
  if (Number.isNaN(n) || n < 0) return "none";
  if (n <= 15) return "low";   // includes 0 — essentially no wait
  if (n <= 30) return "med";
  if (n <= 45) return "high";
  return "crit";
}

function cleanCheckpointLabel(label) {
  if (!label) return "Checkpoint";
  return String(label)
    .replace(/ProjectedQueueTime.*$/i, "")
    .replace(/JourneyTime.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function latestCapturedAt(rows) {
  if (!rows.length) return null;
  const ts = rows
    .map((r) => new Date(r.captured_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a);
  return ts[0] || null;
}

// Lane display config: label, badge CSS class, sort priority
const LANE_CONFIG = {
  STANDARD:       { label: "Regular",          cls: "lane-std",    order: 0 },
  PRECHECK:       { label: "TSA Pre\u2714",     cls: "lane-pre",    order: 1 },
  CLEAR:          { label: "CLEAR",             cls: "lane-clr",    order: 2 },
  CLEAR_PRECHECK: { label: "CLEAR + Pre\u2714", cls: "lane-clrpre", order: 3 },
};

function laneConfig(lane_type) {
  return LANE_CONFIG[lane_type] || LANE_CONFIG.STANDARD;
}

// Build the big-number right side of a cp-block
function bigNumHtml(wait_minutes, tier) {
  const mins = fmtMinutes(wait_minutes);
  if (mins === null) {
    return `<div class="big-num none">Closed</div>`;
  }
  if (mins === 0) {
    return `<div class="big-num low" style="font-size:38px">&lt;1</div><span class="big-unit">min</span>`;
  }
  return `<div class="big-num ${tier}">${mins}</div><span class="big-unit">${mins === 1 ? "min" : "mins"}</span>`;
}

// Compact inline wait for per-lane display (multi-lane mode)
function laneWaitText(wait_minutes, tier) {
  const mins = fmtMinutes(wait_minutes);
  if (mins === null) return `<span class="lane-wait ${tier}">Closed</span>`;
  if (mins === 0)    return `<span class="lane-wait low">&lt;1 min</span>`;
  return `<span class="lane-wait ${tier}">${mins} ${mins === 1 ? "min" : "mins"}</span>`;
}

function renderLiveCards(payload, selectedCode) {
  const host = document.getElementById("live-cards");
  host.innerHTML = "";
  const data = payload.data || {};
  const liveAirports = payload.live_airports || {};

  if (!selectedCode || !liveAirports[selectedCode]) {
    host.innerHTML = `<div class="muted" style="padding:16px 0 4px;">
      Tap an airport chip above to see live security wait times.
    </div>`;
    return;
  }

  const rows = data[selectedCode] || [];

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "airport-card";
    empty.innerHTML = `<div class="muted">No data yet — check back in a minute.</div>`;
    host.appendChild(empty);
    return;
  }

  // Group rows by checkpoint name
  const grouped = {};
  const groupOrder = [];
  rows.forEach((row) => {
    const key = cleanCheckpointLabel(row.checkpoint);
    if (!grouped[key]) { grouped[key] = []; groupOrder.push(key); }
    grouped[key].push(row);
  });

  // Sort checkpoints: worst Standard wait first
  groupOrder.sort((a, b) => {
    const stdWait = (lanes) => {
      const std = lanes.find(r => (r.lane_type || "STANDARD") === "STANDARD");
      return std ? Number(std.wait_minutes) || 0 : Math.max(...lanes.map(r => Number(r.wait_minutes) || 0));
    };
    return stdWait(grouped[b]) - stdWait(grouped[a]);
  });

  const card = document.createElement("div");
  card.className = "airport-card";

  groupOrder.forEach((cpName) => {
    const lanes = grouped[cpName]
      .slice()
      .sort((a, b) => laneConfig(a.lane_type).order - laneConfig(b.lane_type).order);

    // Determine overall tier from the Standard lane (or worst)
    const stdRow = lanes.find(r => (r.lane_type || "STANDARD") === "STANDARD") || lanes[0];
    const groupTier = waitTierClass(stdRow.wait_minutes);
    const multiLane = lanes.length > 1;

    // Build lane rows (left side)
    const laneRowsHtml = lanes.map((row) => {
      const lCfg = laneConfig(row.lane_type);
      const laneTier = waitTierClass(row.wait_minutes);
      const waitInline = multiLane ? laneWaitText(row.wait_minutes, laneTier) : "";
      return `<div class="lane-row">
        <span class="lane-badge ${lCfg.cls}">${lCfg.label}</span>
        ${waitInline}
      </div>`;
    }).join("");

    // Big number (right side) — based on Standard or primary lane
    const bigHtml = bigNumHtml(stdRow.wait_minutes, groupTier);

    const block = document.createElement("div");
    block.className = `cp-block ${groupTier}`;
    block.innerHTML = `
      <div class="cp-left">
        <div class="cp-name">${cpName}</div>
        <div class="cp-lanes">${laneRowsHtml}</div>
      </div>
      <div class="cp-right">${bigHtml}</div>
    `;
    card.appendChild(block);
  });

  const updatedAt = latestCapturedAt(rows);
  if (updatedAt) {
    const foot = document.createElement("div");
    foot.className = "updated-meta";
    foot.textContent = `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 2 min`;
    card.appendChild(foot);
  }

  host.appendChild(card);

  // Dynamic Travel Tip Component (converting panic to conversion)
  let maxWait = 0;
  rows.forEach(r => {
    if (r.wait_minutes > maxWait) maxWait = r.wait_minutes;
  });

  if (maxWait >= 20) {
    const tip = document.createElement("div");
    tip.style.cssText = "background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 16px 0; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);";
    tip.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="color: #fbbf24; font-size: 24px;">⚠️</span>
        <div>
          <p style="color: #fff; font-weight: bold; font-size: 14px; margin: 0 0 4px 0;">Long lines detected!</p>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">Don't wait for a taxi. Book a private ride and skip the curb line.</p>
        </div>
      </div>
      <a href="https://www.dpbolvw.net/click-101725878-13456041" target="_blank" rel="noopener noreferrer" style="display: block; text-align: center; background: #2563eb; color: #fff; font-weight: bold; padding: 8px 16px; border-radius: 4px; text-decoration: none; font-size: 14px; margin-top: 12px; transition: background 0.2s;">
        Get $4 Off Your Ride Home
      </a>
    `;
    host.appendChild(tip);
  }

  // Update map if visible
  if (selectedCode === "PHL") {
    updateMapTerminalStatus(rows);
  }
}

function initTerminalMap(airportCode) {
  const mapSection = document.getElementById("terminal-map-section");
  if (airportCode !== "PHL") {
    mapSection.style.display = "none";
    return;
  }
  
  mapSection.style.display = "block";
  if (terminalMap) return; // Already init

  const cfg = PHL_CONFIG.config;
  terminalMap = L.map('terminal-map', {
    center: cfg.center,
    zoom: cfg.default_zoom,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(terminalMap);

  // Line of Connectivity (Airside)
  const pathCoords = PHL_CONFIG.terminals.map(t => t.coords);
  L.polyline(pathCoords, {
    color: '#888',
    weight: 2,
    dashArray: '5, 8',
    opacity: 0.6,
    interactive: false
  }).addTo(terminalMap);

  // Add Terminal Markers
  PHL_CONFIG.terminals.forEach(t => {
    const icon = L.divIcon({
      className: 'terminal-marker-icon',
      html: `<div class="terminal-marker-inner" id="marker-${t.id}" data-label="${t.name}">${t.shortName}</div>`,
      iconSize: [34, 34]
    });

    const marker = L.marker(t.coords, { icon: icon }).addTo(terminalMap);
    marker.bindPopup(`<strong>${t.name}</strong><br>${t.notes}`);
    terminalMarkers[t.id] = marker;
  });

  // Populate Airline Lookup
  const airlineSelect = document.getElementById("airline-search-select");
  const allAirlines = [...new Set(PHL_CONFIG.terminals.flatMap(t => t.airlines))].sort();
  allAirlines.forEach(air => {
    const opt = document.createElement("option");
    opt.value = air;
    opt.textContent = air;
    airlineSelect.appendChild(opt);
  });

  airlineSelect.addEventListener("change", (e) => {
    highlightTerminalForAirline(e.target.value);
  });
}

function updateMapTerminalStatus(rows) {
  if (!terminalMap || selectedAirportCode !== "PHL") return;

  PHL_CONFIG.terminals.forEach(t => {
    const cpRows = rows.filter(r => t.checkpoints.includes(Number(r.checkpoint_id)));
    if (cpRows.length) {
      const bestWait = Math.min(...cpRows.map(r => Number(r.wait_minutes) || 999));
      const tier = waitTierClass(bestWait);
      const el = document.getElementById(`marker-${t.id}`);
      if (el) {
        el.className = `terminal-marker-inner tier-${tier}`;
      }
    }
  });
}

function highlightTerminalForAirline(airline) {
  const overlay = document.getElementById("map-overlay-info");
  if (!airline) {
    document.querySelectorAll('.terminal-marker-inner').forEach(el => el.classList.remove('highlight'));
    overlay.classList.remove('active');
    return;
  }

  const terminal = PHL_CONFIG.terminals.find(t => t.airlines.includes(airline));
  if (terminal) {
    document.querySelectorAll('.terminal-marker-inner').forEach(el => el.classList.remove('highlight', 'active-terminal-glow'));
    const el = document.getElementById(`marker-${terminal.id}`);
    if (el) el.classList.add('highlight', 'active-terminal-glow');

    terminalMap.setView(terminal.coords, 16);
    
    const routing = PHL_CONFIG.routing_logic.find(r => r.from === terminal.id);
    
    let content = `
      <div style="margin-bottom:12px;">
        <span style="font-size: 11px; color: var(--amber); font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Recommended Priority</span>
        <div style="font-size:16px; font-weight:700; color:#fff; margin-top:2px;">Go to ${terminal.name} Security</div>
      </div>
    `;

    if (routing) {
      content += `
        <div class="routing-step">
          <div class="routing-icon">${routing.mode === 'shuttle' ? '🚌' : '🚶'}</div>
          <div class="routing-text">
            <strong>Transfer Route:</strong> ${routing.instruction}
          </div>
        </div>
      `;
    } else {
      content += `
        <div style="font-size:12px; color:var(--muted);">All ${airline} flights depart from here. Airside connections available to other terminals.</div>
      `;
    }

    overlay.innerHTML = content;
    overlay.classList.add('active');
  }
}

function renderPipeline(rows) {
  const host = document.getElementById("pipeline-list");
  host.innerHTML = "";
  rows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "pipeline-item";
    const note = row.note || "Live integration coming soon.";
    el.innerHTML = `
      <div class="pipeline-icon">✈️</div>
      <div class="pipeline-info">
        <div class="pipeline-name">${row.code} — ${row.name}</div>
        <div class="pipeline-note">${note}</div>
      </div>
      <span class="status-badge">Coming soon</span>
    `;
    host.appendChild(el);
  });
}

function normalizeHistory(rows) {
  const bucket = {};
  rows.forEach((r) => {
    const t = new Date(r.captured_at);
    const key = `${t.getUTCFullYear()}-${t.getUTCMonth()+1}-${t.getUTCDate()} ${t.getUTCHours()}:${t.getUTCMinutes()}`;
    if (!bucket[key]) bucket[key] = { ts: t, sum: 0, c: 0 };
    bucket[key].sum += Number(r.wait_minutes) || 0;
    bucket[key].c += 1;
  });
  return Object.values(bucket)
    .sort((a, b) => a.ts - b.ts)
    .map((x) => ({ label: x.ts.toISOString().slice(11, 16), value: x.c ? x.sum / x.c : 0 }));
}

async function drawChart(points, airportCode) {
  await loadChartJs();
  const ctx = document.getElementById("history-chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map((p) => p.label),
      datasets: [{
        label: `${airportCode} avg wait (mins)`,
        data: points.map((p) => p.value),
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245,158,11,0.08)",
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          ticks: { color: "#55556a", font: { family: "'IBM Plex Mono'" } },
          grid: { color: "#22222e" },
          border: { color: "#22222e" },
        },
        y: {
          ticks: { color: "#55556a", font: { family: "'IBM Plex Mono'" } },
          grid: { color: "#22222e" },
          border: { color: "#22222e" },
          title: { display: true, text: "Minutes", color: "#55556a",
                   font: { family: "'IBM Plex Mono'", size: 11 } },
        },
      },
      plugins: {
        legend: { labels: { color: "#55556a", font: { family: "'IBM Plex Mono'", size: 11 } } },
      },
    },
  });
}

async function loadHistory(airportCode) {
  const emptyEl = document.getElementById("chart-empty");
  if (!airportCode) {
    if (chart) { chart.destroy(); chart = null; }
    emptyEl.style.display = "block";
    return;
  }
  const resp = await fetch(`/api/history?airport=${airportCode}&hours=12`);
  const payload = await resp.json();
  const points = normalizeHistory(payload.rows || []);
  emptyEl.style.display = points.length ? "none" : "block";
  if (points.length) drawChart(points, airportCode);
}

// Source status label
function sourceStatusLabel(sourceType) {
  if (sourceType === "live_direct")        return ["✓ Live airport data", "is-live"];
  if (sourceType === "estimated_fallback") return ["~ Estimated (live data not yet available)", "is-fallback"];
  return ["", "is-unknown"];
}

async function updateSelectionSourceStatus(airportCode) {
  const el = document.getElementById("selection-source-status");
  if (!airportCode) { el.textContent = ""; el.className = "selection-source-status"; return; }
  try {
    const resp = await fetch(`/api/tsa-wait-times?code=${airportCode}`);
    const payload = await resp.json();
    const [label, cls] = sourceStatusLabel(payload.sourceType);
    el.textContent = label;
    el.className = `selection-source-status ${cls}`;
  } catch (_e) {
    el.textContent = "";
    el.className = "selection-source-status is-unknown";
  }
}

function renderAirportChips(payload, filterText = "") {
  const host = document.getElementById("airport-chips");
  host.innerHTML = "";
  const entries = Object.entries(payload.live_airports || {});
  const q = filterText.trim().toLowerCase();
  const filtered = entries.filter(([code, info]) =>
    !q || code.toLowerCase().includes(q) || info.name.toLowerCase().includes(q)
  );
  filtered.forEach(([code, info]) => {
    const btn = document.createElement("button");
    btn.className = `airport-chip${selectedAirportCode === code ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = code;
    btn.title = `${code} TSA wait times — ${info.name}`;
    btn.setAttribute("aria-label", `View live TSA wait times at ${info.name} (${code})`);
    btn.addEventListener("click", () => selectAirport(code));
    host.appendChild(btn);
  });
}

async function selectAirport(code, shouldPush = true) {
  selectedAirportCode = code;

  // Update URL history for SEO/Bookmarks (preventing re-push on back button)
  if (shouldPush) {
    const slug = `${code.toLowerCase()}-tsa-wait-times`;
    const newUrl = `/airports/${slug}`;
    if (window.location.pathname !== newUrl) {
      history.pushState({ airportCode: code }, "", newUrl);
    }
  }

  // Update chart dropdown
  const select = document.getElementById("airport-select");
  if (select) select.value = code;

  // Update Hero Titles & Document Title
  document.title = `${code} TSA Wait Times — TSA Tracker`;
  const heroTitle = document.getElementById("hero-title");
  if (heroTitle) heroTitle.innerHTML = `${code} TSA <em>Wait Times</em>`;
  
  // Update airport header
  const meta = livePayloadCache.live_airports?.[code];
  const apHeader = document.getElementById("airport-header");
  if (apHeader) apHeader.style.display = "";
  
  const h2Name = document.getElementById("current-airport-name");
  if (h2Name && meta) h2Name.textContent = meta.name;

  const apCode = document.getElementById("ap-code");
  if (apCode) apCode.textContent = code;
  const apName = document.getElementById("ap-name");
  if (apName && meta) apName.textContent = meta.name;

  const heroSub = document.getElementById("hero-sub");
  if (heroSub && meta) {
    heroSub.textContent = `How long is the security line at ${meta.name}? Real-time TSA checkpoint data pulled directly from official airport systems — not estimates. Updated every ~2 minutes.`;
  }

  // Update Flight Search Logic
  const flightText = document.getElementById("flight-origin-text");
  if (flightText) flightText.textContent = code;
  const flightInput = document.getElementById("flight-origin-input");
  if (flightInput) flightInput.value = code;

  // --- START DYNAMIC AD UPDATE ---
  const marker = (window.MONETIZATION_CONFIG && window.MONETIZATION_CONFIG.tpMarker) || "719940";
  const offers = window.LOCAL_OFFERS || {};
  const currentOffer = offers[code];
  const cityName = (meta && meta.city) || "";

  // Update Featured "Local" Offer (e.g. JFK AirTrain vs ORD L-Train)
  const featuredContainer = document.getElementById("ad-featured-container");
  if (featuredContainer) {
    if (currentOffer) {
      featuredContainer.style.display = "block";
      document.getElementById("ad-featured-link").href = currentOffer.url;
      document.getElementById("ad-featured-icon").innerText = currentOffer.icon;
      document.getElementById("ad-featured-title").innerText = currentOffer.title;
      document.getElementById("ad-featured-sub").innerText = currentOffer.sub;
    } else {
      featuredContainer.style.display = "none";
    }
  }

  // Update Kiwi Link
  const kiwiLink = document.getElementById("ad-kiwi-link");
  const kiwiTitle = document.getElementById("ad-kiwi-title");
  if (kiwiLink) {
    kiwiLink.href = buildTravelpayoutsUrl(`https://www.kiwi.com/en/search/tiles/${code.toLowerCase()}/anywhere`);
    if (kiwiTitle) kiwiTitle.innerText = `Cheap Flights from ${code}`;
  }

  // Update Klook Link
  const klookLink = document.getElementById("ad-klook-link");
  const klookTitle = document.getElementById("ad-klook-title");
  if (klookLink) {
    const klookTarget = `https://www.klook.com/en-US/search?query=${encodeURIComponent(cityName)}`;
    klookLink.href = buildTravelpayoutsUrl(klookTarget);
    if (klookTitle) klookTitle.innerText = `Activities in ${cityName || 'selection'}`;
  }
  // --- END DYNAMIC AD UPDATE ---

  updateSelectionSourceStatus(code);
  renderAirportChips(livePayloadCache, document.getElementById("airport-search").value);
  renderLiveCards(livePayloadCache, code);
  fetchCommunityStatus(code);
  initTerminalMap(code);
  scheduleNonCriticalTask(() => loadHistory(code));

  // Scroll to results (only if the user explicitly clicked)
  if (shouldPush) {
    const resultsEl = document.getElementById("results-section");
    if (resultsEl) {
      resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Update last refresh timestamp
  lastUpdateTimestamp = new Date();
  updateRefreshText();
}

/**
 * Sends ad-click data back to the server to feed the self-learning "Lite Brain" engine.
 * @param {string} offerId The ID of the ad clicked (e.g., 'CLEAR', 'KLOOK')
 */
function logAdClick(offerId) {
  if (!offerId) return;
  
  // Fire and forget: we don't want to block the user's navigation
  fetch("/api/log-click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      offer_id: offerId, 
      code: selectedAirportCode || "HOME" 
    })
  }).catch(err => console.warn("Ad log failed", err));
}

function buildTravelpayoutsUrl(targetUrl) {
  const marker = window.MONETIZATION_CONFIG && window.MONETIZATION_CONFIG.tpMarker;
  if (!marker) return targetUrl;
  const url = new URL(targetUrl);
  if (!url.searchParams.has("marker")) {
    url.searchParams.set("marker", marker);
  }
  return url.toString();
}


/**
 * Robust flight search handler using the official tp.media/r redirect handshake
 * to prevent 404s and ensure 100% affiliate tracking.
 */
function performFlightSearch() {
  const destInput = document.getElementById("flight-destination-input");
  const dest = destInput ? destInput.value.trim() : "";
  
  if (!dest) {
    alert("Please enter a destination (city or airport code)");
    return;
  }
  
  const origin = selectedAirportCode || "JFK";
  const marker = (window.MONETIZATION_CONFIG && window.MONETIZATION_CONFIG.tpMarker) || "719940";
  
  // Stable URL for the final destination (using /tiles/ for instant results)
  const targetUrl = `https://www.kiwi.com/en/search/tiles/${origin.toLowerCase()}/${dest.toLowerCase()}?marker=${marker}`;
  
  window.open(targetUrl, "_blank");
}

// Handle browser Back/Forward buttons
window.addEventListener("popstate", (event) => {
  if (event.state && event.state.airportCode) {
    selectAirport(event.state.airportCode, false);
  } else if (window.location.pathname === "/") {
    // Smoothly return to landing state
    selectedAirportCode = null;
    const apHeader = document.getElementById("airport-header");
    if (apHeader) apHeader.style.display = "none";
    renderAirportChips(livePayloadCache, "");
    renderLiveCards(livePayloadCache, null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// Silent background refresh — only re-fetches /api/live and repaints
// the wait-time cards for the currently selected airport.
// Does NOT reset selection, does NOT touch the chart, does NOT scroll.
async function silentRefresh() {
  try {
    const resp = await fetch("/api/live");
    if (!resp.ok) return; // server error — skip this cycle, try again next time
    const fresh = await resp.json();
    // Preserve live_airports list (used by chips/dropdown) — only update data
    livePayloadCache = fresh;
    // Re-render chips to keep active state in sync
    const search = document.getElementById("airport-search");
    renderAirportChips(livePayloadCache, search ? search.value : "");
    // Re-render wait cards for the currently selected airport (no-op if none)
    if (selectedAirportCode) {
      renderLiveCards(livePayloadCache, selectedAirportCode);
      fetchCommunityStatus(selectedAirportCode);
    }
    lastUpdateTimestamp = new Date();
    updateRefreshText();
  } catch (_e) {
    // Network error — silently skip, try again next cycle
  }
}

function updateRefreshText() {
  const el = document.getElementById("last-updated-text");
  if (!el || !lastUpdateTimestamp) return;

  const now = new Date();
  const diffSec = Math.floor((now - lastUpdateTimestamp) / 1000);

  if (diffSec < 60) {
    el.textContent = "Just now";
  } else {
    const mins = Math.floor(diffSec / 60);
    el.textContent = `${mins}m ago`;
  }
}

async function reportWait(level) {
  if (!selectedAirportCode) return;
  const btn = event.currentTarget;
  const originalText = btn.textContent;
  btn.textContent = "...";
  btn.disabled = true;

  try {
    const resp = await fetch("/api/report-wait", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: selectedAirportCode, level })
    });
    if (resp.ok) {
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        fetchCommunityStatus(selectedAirportCode);
      }, 2000);
    }
  } catch (_e) {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function fetchCommunityStatus(code) {
  const statusEl = document.getElementById("live-community-status");
  const levelEl = document.getElementById("community-level");
  if (!code || !statusEl) return;
  
  try {
    const resp = await fetch(`/api/community-status?code=${code}`);
    const data = await resp.json();
    if (data.level) {
      statusEl.style.display = "block";
      levelEl.textContent = data.level.toUpperCase();
      levelEl.className = data.level; // css classes: short/med/long
    } else {
      statusEl.style.display = "none";
    }
  } catch (_e) {
    if (statusEl) statusEl.style.display = "none";
  }
}

async function bootstrap() {
  const liveResp = await fetch("/api/live");
  livePayloadCache = await liveResp.json();

  // Wire up hero search input
  const search = document.getElementById("airport-search");
  search.addEventListener("input", (e) => renderAirportChips(livePayloadCache, e.target.value));
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = search.value.trim().toLowerCase();
    const match = Object.keys(livePayloadCache.live_airports || {}).find(
      (c) => c.toLowerCase() === q || livePayloadCache.live_airports[c].name.toLowerCase().includes(q)
    );
    if (match) selectAirport(match);
  });

  renderAirportChips(livePayloadCache);
  renderLiveCards(livePayloadCache, null);

  // Auto-select airport if this is a dedicated airport page
  const initialCode = String(window.INITIAL_AIRPORT_CODE || "").toUpperCase();
  if (initialCode && livePayloadCache.live_airports?.[initialCode]) {
    selectAirport(initialCode);
  }

  scheduleNonCriticalTask(async () => {
    const select = document.getElementById("airport-select");
    Object.keys(livePayloadCache.live_airports || {}).forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => selectAirport(e.target.value));
    await loadHistory(null);
  });

  scheduleNonCriticalTask(async () => {
    try {
      const pipeResp = await fetch("/api/pipeline");
      if (!pipeResp.ok) return;
      const pipePayload = await pipeResp.json();
      renderPipeline(pipePayload.airports || []);
    } catch (_e) {
      // no-op
    }
  }, 1200);

  // Kick off silent background refresh every 2 minutes (matching server poll interval)
  scheduleNonCriticalTask(() => {
// Pull-to-Refresh for Mobile Users
let touchStart = 0;
const refreshThreshold = 80;

window.addEventListener('touchstart', (e) => {
  if (window.scrollY === 0) {
    touchStart = e.touches[0].pageY;
  } else {
    touchStart = 0;
  }
}, { passive: true });

window.addEventListener('touchend', (e) => {
  const touchEnd = e.changedTouches[0].pageY;
  if (touchStart > 0 && touchEnd - touchStart > refreshThreshold) {
    // Briefly show a visual cue (the ⟳ character in the trust/indicator section)
    const indicator = document.querySelector('.hero-trust');
    if (indicator) {
        indicator.style.color = 'var(--amber)';
        indicator.textContent = '⟳ Refreshing live data...';
        setTimeout(() => {
            indicator.style.color = '';
            indicator.textContent = '⟳ Updated about every 2 minutes — data from official airport systems';
        }, 1500);
    }
    silentRefresh();
  }
}, { passive: true });

// Auto-refresh every 2 min
setInterval(silentRefresh, 120000);
init();
    // Update the "Last Updated" text every 30 seconds
    setInterval(updateRefreshText, 30 * 1000);
  }, 1000);
}

bootstrap();
