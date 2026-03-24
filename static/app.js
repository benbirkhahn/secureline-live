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

  const card = document.createElement("div");
  card.className = "airport-card";

  const list = (data[selectedCode] || [])
    .sort((a, b) => b.wait_minutes - a.wait_minutes)
    .slice(0, 10);

  if (!list.length) {
    card.innerHTML = `<div class="muted">No data yet — check back in a minute.</div>`;
  } else {
    list.forEach((row) => {
      const el = document.createElement("div");
      const tier = waitTierClass(row.wait_minutes);
      el.className = `checkpoint-row ${tier}`;
      const mins = fmtMinutes(row.wait_minutes);
      const waitHtml = (mins === null)
        ? `<span class="wait-closed-label">Closed</span>`
        : mins === 0
          ? `<div class="wait-display">
               <span class="wait-number" style="font-size:22px">&lt;1</span>
               <span class="wait-unit">min</span>
             </div>`
          : `<div class="wait-display">
               <span class="wait-number">${mins}</span>
               <span class="wait-unit">${mins === 1 ? "min" : "mins"}</span>
             </div>`;
      el.innerHTML = `
        <div class="checkpoint-name">${cleanCheckpointLabel(row.checkpoint)}</div>
        ${waitHtml}
      `;
      card.appendChild(el);
    });

    const updatedAt = latestCapturedAt(list);
    if (updatedAt) {
      const foot = document.createElement("div");
      foot.className = "updated-meta";
      foot.textContent = `Last updated: ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      card.appendChild(foot);
    }
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
