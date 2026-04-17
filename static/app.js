let chart;
let livePayloadCache = null;
let selectedAirportCode = null;
let chartJsPromise = null;
const hasRIC = typeof window !== "undefined" && "requestIdleCallback" in window;

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

async function selectAirport(code) {
  selectedAirportCode = code;

  // Update chart dropdown
  const select = document.getElementById("airport-select");
  if (select) select.value = code;

  // Update airport header
  const meta = livePayloadCache.live_airports?.[code];
  const apHeader = document.getElementById("airport-header");
  if (apHeader) apHeader.style.display = "";
  const apCode = document.getElementById("ap-code");
  if (apCode) apCode.textContent = code;
  const apName = document.getElementById("ap-name");
  if (apName && meta) apName.textContent = meta.name;

  updateSelectionSourceStatus(code);
  renderAirportChips(livePayloadCache, document.getElementById("airport-search").value);
  renderLiveCards(livePayloadCache, code);
  scheduleNonCriticalTask(() => loadHistory(code));

  // Scroll to results
  const resultsEl = document.getElementById("results-section");
  if (resultsEl) {
    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

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
    }
  } catch (_e) {
    // Network error — silently skip, try again next cycle
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
    setInterval(silentRefresh, 2 * 60 * 1000);
  }, 1000);
}

bootstrap();
