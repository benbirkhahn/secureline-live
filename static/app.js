let chart;
let livePayloadCache = null;
let selectedAirportCode = null;

function fmtMinutes(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return null; // null = truly closed/no data
  if (n === 0) return 0; // 0 = "< 1 min" — open with no queue
  return Math.max(1, Math.round(n));
}

// Returns a tier class for the colored row background
function waitTierClass(waitMinutes) {
  const n = Number(waitMinutes);
  if (Number.isNaN(n) || n < 0) return "tier-closed";
  if (n <= 15) return "tier-low"; // includes 0 — essentially no wait
  if (n <= 30) return "tier-med";
  if (n <= 45) return "tier-high";
  return "tier-critical";
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

// Lane display config: label, badge CSS class, sort priority (lower = first)
const LANE_CONFIG = {
  STANDARD:       { label: "Regular",          cls: "lane-standard",  order: 0 },
  PRECHECK:       { label: "TSA Pre\u2714",     cls: "lane-precheck",  order: 1 },
  CLEAR:          { label: "CLEAR",             cls: "lane-clear",     order: 2 },
  CLEAR_PRECHECK: { label: "CLEAR + Pre\u2714", cls: "lane-clear-pre", order: 3 },
};

function laneConfig(lane_type) {
  return LANE_CONFIG[lane_type] || LANE_CONFIG.STANDARD;
}

function waitHtml(wait_minutes) {
  const mins = fmtMinutes(wait_minutes);
  if (mins === null) return `<span class="wait-closed-label">Closed</span>`;
  if (mins === 0)    return `<div class="wait-display"><span class="wait-number wait-number--sm">&lt;1</span><span class="wait-unit">min</span></div>`;
  return `<div class="wait-display"><span class="wait-number">${mins}</span><span class="wait-unit">${mins === 1 ? "min" : "mins"}</span></div>`;
}

function renderLiveCards(payload, selectedCode) {
  const host = document.getElementById("live-cards");
  host.innerHTML = "";
  const data = payload.data || {};
  const liveAirports = payload.live_airports || {};

  if (!selectedCode || !liveAirports[selectedCode]) {
    host.innerHTML = `<div class="muted" style="padding:16px 0 4px;">
      Tap an airport above to see how long the security line is right now.
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
    const worstWait = (lanes) => Math.max(...lanes.map(r => Number(r.wait_minutes) || 0));
    const stdWait = (lanes) => {
      const std = lanes.find(r => (r.lane_type || "STANDARD") === "STANDARD");
      return std ? Number(std.wait_minutes) || 0 : worstWait(lanes);
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

    const group = document.createElement("div");
    group.className = `checkpoint-group ${groupTier}`;

    // Header: checkpoint name
    const header = document.createElement("div");
    header.className = "checkpoint-group-header";
    header.textContent = cpName;
    group.appendChild(header);

    if (!multiLane) {
      // Single lane — simple layout
      const lCfg = laneConfig(lanes[0].lane_type);
      group.innerHTML += `
        <div class="lane-row lane-row--single">
          <span class="lane-badge ${lCfg.cls}">${lCfg.label}</span>
          ${waitHtml(lanes[0].wait_minutes)}
        </div>`;
    } else {
      // Multi-lane — sub-rows
      const laneList = document.createElement("div");
      laneList.className = "lane-list";
      lanes.forEach((row) => {
        const lCfg = laneConfig(row.lane_type);
        const tier = waitTierClass(row.wait_minutes);
        const laneEl = document.createElement("div");
        laneEl.className = `lane-row ${tier}`;
        laneEl.innerHTML = `
          <span class="lane-badge ${lCfg.cls}">${lCfg.label}</span>
          ${waitHtml(row.wait_minutes)}
        `;
        laneList.appendChild(laneEl);
      });
      group.appendChild(laneList);
    }

    card.appendChild(group);
  });

  const updatedAt = latestCapturedAt(rows);
  if (updatedAt) {
    const foot = document.createElement("div");
    foot.className = "updated-meta";
    foot.textContent = `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    card.appendChild(foot);
  }

  host.appendChild(card);
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

function drawChart(points, airportCode) {
  const ctx = document.getElementById("history-chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map((p) => p.label),
      datasets: [{
        label: `${airportCode} avg wait (mins)`,
        data: points.map((p) => p.value),
        borderColor: "#2563eb",
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { color: "#e2e8f0" } },
        y: { ticks: { color: "#64748b" }, grid: { color: "#e2e8f0" },
             title: { display: true, text: "Minutes", color: "#334155" } },
      },
      plugins: { legend: { labels: { color: "#334155" } } },
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

// Simple, plain-English source status — no jargon
function sourceStatusLabel(sourceType) {
  if (sourceType === "live_direct")       return ["✓ Live airport data", "is-live"];
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

function setSelectionSummary(payload, airportCode) {
  // kept for API compatibility — hidden in new design; heading updates instead
  const target = document.getElementById("selection-summary");
  if (target) target.style.display = "none";
}

function renderAirportChips(payload, filterText = "") {
  const host = document.getElementById("airport-chips");
  host.innerHTML = "";
  const entries = Object.entries(payload.live_airports || {});
  const q = filterText.trim().toLowerCase();
  const filtered = entries.filter(([code, info]) =>
    !q || code.toLowerCase().includes(q) || info.name.toLowerCase().includes(q)
  );
  filtered.forEach(([code]) => {
    const btn = document.createElement("button");
    btn.className = `airport-chip${selectedAirportCode === code ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = code;
    btn.addEventListener("click", () => selectAirport(code));
    host.appendChild(btn);
  });
}

async function selectAirport(code) {
  selectedAirportCode = code;

  // Update chart dropdown
  const select = document.getElementById("airport-select");
  select.value = code;

  // Update results heading with friendly airport name
  const heading = document.getElementById("results-heading");
  const meta = livePayloadCache.live_airports?.[code];
  if (heading && meta) heading.textContent = `${code} — ${meta.name}`;

  // Show the "● Live" badge
  const liveBadge = document.getElementById("live-badge");
  if (liveBadge) liveBadge.style.display = "";

  setSelectionSummary(livePayloadCache, code);
  await updateSelectionSourceStatus(code);
  renderAirportChips(livePayloadCache, document.getElementById("airport-search").value);
  renderLiveCards(livePayloadCache, code);
  await loadHistory(code);

  // Scroll down so user sees results without hunting for them
  const resultsEl = document.getElementById("results-section");
  if (resultsEl) {
    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function bootstrap() {
  const [liveResp, pipeResp] = await Promise.all([fetch("/api/live"), fetch("/api/pipeline")]);
  livePayloadCache = await liveResp.json();
  const pipePayload = await pipeResp.json();
  renderPipeline(pipePayload.airports || []);

  // Populate chart airport dropdown
  const select = document.getElementById("airport-select");
  Object.keys(livePayloadCache.live_airports || {}).forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    select.appendChild(opt);
  });
  select.addEventListener("change", (e) => selectAirport(e.target.value));

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
  await loadHistory(null);

  // Auto-select airport if this is a dedicated airport page
  const initialCode = String(window.INITIAL_AIRPORT_CODE || "").toUpperCase();
  if (initialCode && livePayloadCache.live_airports?.[initialCode]) {
    await selectAirport(initialCode);
  }
}

bootstrap();
