let chart;
let livePayloadCache = null;
let selectedAirportCode = null;

function fmtMinutes(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  if (n <= 0) return "Closed";
  return `${Math.max(1, Math.round(n))} min`;
}

function waitTierClass(waitMinutes) {
  const n = Number(waitMinutes);
  if (n <= 0) return "wait-pill closed";
  if (n <= 15) return "wait-pill low";
  if (n <= 30) return "wait-pill med";
  if (n <= 45) return "wait-pill high";
  return "wait-pill critical";
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
    host.innerHTML = `<div class="muted">Use the airport lookup above to populate live waits.</div>`;
    return;
  }

  const card = document.createElement("div");
  card.className = "airport-card";
  const list = (data[selectedCode] || [])
    .sort((a, b) => b.wait_minutes - a.wait_minutes)
    .slice(0, 10);
  card.innerHTML = `<h3>${selectedCode} — ${liveAirports[selectedCode].name}</h3>`;
  if (!list.length) {
    card.innerHTML += `<div class="muted">No rows collected yet.</div>`;
  } else {
    list.forEach((row) => {
      const el = document.createElement("div");
      el.className = "checkpoint-row";
      el.innerHTML = `
        <div class="checkpoint-name">${cleanCheckpointLabel(row.checkpoint)}</div>
        <div class="${waitTierClass(row.wait_minutes)}">${fmtMinutes(row.wait_minutes)}</div>
      `;
      card.appendChild(el);
    });
    const updatedAt = latestCapturedAt(list);
    if (updatedAt) {
      const foot = document.createElement("div");
      foot.className = "updated-meta";
      foot.textContent = `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
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
    el.innerHTML = `
      <div><strong>${row.code}</strong> — ${row.name}</div>
      <div style="margin-top:6px;"><span class="status-badge">${row.status}</span></div>
      ${row.note ? `<div class="muted" style="margin-top:8px;">${row.note}</div>` : ""}
    `;
    host.appendChild(el);
  });
}

function normalizeHistory(rows) {
  const bucket = {};
  rows.forEach((r) => {
    const t = new Date(r.captured_at);
    const key = `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()} ${t.getUTCHours()}:${t.getUTCMinutes()}`;
    if (!bucket[key]) bucket[key] = { ts: t, sum: 0, c: 0 };
    bucket[key].sum += Number(r.wait_minutes) || 0;
    bucket[key].c += 1;
  });
  return Object.values(bucket)
    .sort((a, b) => a.ts - b.ts)
    .map((x) => ({
      label: x.ts.toISOString().slice(11, 16),
      value: x.c ? x.sum / x.c : 0,
    }));
}

function drawChart(points, airportCode) {
  const ctx = document.getElementById("history-chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: `${airportCode} Avg Wait`,
          data: points.map((p) => p.value),
          borderColor: "#2563eb",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          ticks: { color: "#64748b" },
          grid: { color: "#e2e8f0" },
        },
        y: {
          ticks: { color: "#64748b" },
          grid: { color: "#e2e8f0" },
          title: { display: true, text: "Minutes", color: "#334155" },
        },
      },
      plugins: {
        legend: { labels: { color: "#334155" } },
      },
    },
  });
}

async function loadHistory(airportCode) {
  const emptyEl = document.getElementById("chart-empty");
  if (!airportCode) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    emptyEl.style.display = "block";
    return;
  }
  const resp = await fetch(`/api/history?airport=${airportCode}&hours=12`);
  const payload = await resp.json();
  const points = normalizeHistory(payload.rows || []);
  emptyEl.style.display = points.length ? "none" : "block";
  drawChart(points, airportCode);
}

function setSelectionSummary(payload, airportCode) {
  const target = document.getElementById("selection-summary");
  const sourceTarget = document.getElementById("selection-source-status");
  const meta = payload.live_airports?.[airportCode];
  if (!airportCode || !meta) {
    target.textContent = "No airport selected yet.";
    sourceTarget.textContent = "";
    sourceTarget.className = "selection-source-status";
    return;
  }
  target.textContent = `Selected: ${airportCode} — ${meta.name}`;
}

function sourceStatusLabel(sourceType, sourceReason) {
  if (sourceType === "live_direct") return ["Live direct source", "is-live"];
  if (sourceType === "estimated_fallback") {
    if (sourceReason === "live_stale_or_unavailable") return ["Fallback estimate (live temporarily unavailable)", "is-fallback"];
    return ["Estimated source (not yet live-integrated)", "is-fallback"];
  }
  return ["Source status unavailable", "is-unknown"];
}

async function updateSelectionSourceStatus(airportCode) {
  const sourceTarget = document.getElementById("selection-source-status");
  if (!airportCode) {
    sourceTarget.textContent = "";
    sourceTarget.className = "selection-source-status";
    return;
  }
  try {
    const resp = await fetch(`/api/tsa-wait-times?code=${airportCode}`);
    const payload = await resp.json();
    const [label, cls] = sourceStatusLabel(payload.sourceType, payload.sourceReason);
    sourceTarget.textContent = `Data source: ${label}`;
    sourceTarget.className = `selection-source-status ${cls}`;
  } catch (_e) {
    sourceTarget.textContent = "Data source: unavailable";
    sourceTarget.className = "selection-source-status is-unknown";
  }
}

function renderAirportChips(payload, filterText = "") {
  const host = document.getElementById("airport-chips");
  host.innerHTML = "";
  const entries = Object.entries(payload.live_airports || {});
  const q = filterText.trim().toLowerCase();
  const filtered = entries.filter(([code, info]) => {
    if (!q) return true;
    return code.toLowerCase().includes(q) || info.name.toLowerCase().includes(q);
  });
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
  const select = document.getElementById("airport-select");
  select.value = code;
  setSelectionSummary(livePayloadCache, code);
  await updateSelectionSourceStatus(code);
  renderAirportChips(livePayloadCache, document.getElementById("airport-search").value);
  renderLiveCards(livePayloadCache, code);
  await loadHistory(code);
}

async function bootstrap() {
  const [liveResp, pipeResp] = await Promise.all([fetch("/api/live"), fetch("/api/pipeline")]);
  livePayloadCache = await liveResp.json();
  const pipePayload = await pipeResp.json();
  renderPipeline(pipePayload.airports || []);

  const select = document.getElementById("airport-select");
  Object.keys(livePayloadCache.live_airports || {}).forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    select.appendChild(opt);
  });
  select.addEventListener("change", (e) => selectAirport(e.target.value));

  const search = document.getElementById("airport-search");
  search.addEventListener("input", (e) => renderAirportChips(livePayloadCache, e.target.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = search.value.trim().toLowerCase();
      const match = Object.keys(livePayloadCache.live_airports || {}).find(
        (c) =>
          c.toLowerCase() === q ||
          livePayloadCache.live_airports[c].name.toLowerCase().includes(q)
      );
      if (match) selectAirport(match);
    }
  });

  renderAirportChips(livePayloadCache);
  renderLiveCards(livePayloadCache, null);
  await loadHistory(null);

  const initialCode = String(window.INITIAL_AIRPORT_CODE || "").toUpperCase();
  if (initialCode && livePayloadCache.live_airports?.[initialCode]) {
    await selectAirport(initialCode);
  }
}

bootstrap();
