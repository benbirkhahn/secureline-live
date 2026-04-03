let chart;
let livePayloadCache = null;
let selectedAirportCode = null;

function fmtMinutes(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return null; // null = truly closed/no data
  if (n === 0) return 0;                      // 0 = "< 1 min" — open with no queue
  return Math.max(1, Math.round(n));
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

// Map logical tiers to our Tailwind colors
const TIER_CONFIG = {
  low:  { text: "text-[#00f2ff]",      bg: "bg-[#00f2ff]/10", border: "border-l-2 border-[#00f2ff]", label: "Optimal",  icon: "check_circle" },
  med:  { text: "text-[#88d1e7]",      bg: "bg-[#88d1e7]/10", border: "border-l-2 border-[#88d1e7]", label: "Nominal",  icon: "bar_chart" },
  high: { text: "text-orange-400",     bg: "bg-orange-400/10",border: "border-l-2 border-orange-400",label: "Elevated", icon: "warning" },
  crit: { text: "text-[#ffb4ab]",      bg: "bg-[#ffb4ab]/10", border: "border-l-2 border-[#ffb4ab]", label: "Congested",icon: "error" },
  none: { text: "text-surface-variant",bg: "bg-surface-variant/10", border: "border-l-2 border-surface-variant", label: "Closed", icon: "block" }
};

function waitTier(waitMinutes) {
  const n = Number(waitMinutes);
  if (Number.isNaN(n) || n < 0) return "none";
  if (n <= 15) return "low";
  if (n <= 30) return "med";
  if (n <= 45) return "high";
  return "crit";
}

const LANE_CONFIG = {
  STANDARD:       { label: "Regular",          cls: "text-[#88d1e7] bg-[#37374f]",    order: 0 },
  PRECHECK:       { label: "TSA Pre\u2714",     cls: "text-[#00f2ff] bg-[#00f2ff]/20 border border-[#00f2ff]/30", order: 1 },
  CLEAR:          { label: "CLEAR",             cls: "text-orange-400 bg-orange-400/20 border border-orange-400/30", order: 2 },
  CLEAR_PRECHECK: { label: "CLEAR + Pre\u2714", cls: "text-green-400 bg-green-400/20 border border-green-400/30", order: 3 },
};

function laneConfig(lane_type) {
  return LANE_CONFIG[lane_type] || LANE_CONFIG.STANDARD;
}

function renderLiveCards(payload, selectedCode) {
  const host = document.getElementById("live-cards");
  if (!host) return;
  host.innerHTML = "";
  const data = payload.data || {};
  const liveAirports = payload.live_airports || {};

  if (!selectedCode || !liveAirports[selectedCode]) {
    host.innerHTML = `<div class="text-sm text-secondary opacity-60 col-span-12">Tap an airport to view terminal intelligence.</div>`;
    return;
  }

  const rows = data[selectedCode] || [];

  if (!rows.length) {
    host.innerHTML = `<div class="text-sm text-secondary opacity-60 col-span-12">No data yet — scanning terminal nodes...</div>`;
    return;
  }

  const grouped = {};
  const groupOrder = [];
  rows.forEach((row) => {
    const key = cleanCheckpointLabel(row.checkpoint);
    if (!grouped[key]) { grouped[key] = []; groupOrder.push(key); }
    grouped[key].push(row);
  });

  groupOrder.sort((a, b) => {
    const stdWait = (lanes) => {
      const std = lanes.find(r => (r.lane_type || "STANDARD") === "STANDARD");
      return std ? Number(std.wait_minutes) || 0 : Math.max(...lanes.map(r => Number(r.wait_minutes) || 0));
    };
    return stdWait(grouped[b]) - stdWait(grouped[a]);
  });

  groupOrder.forEach((cpName) => {
    const lanes = grouped[cpName]
      .slice()
      .sort((a, b) => laneConfig(a.lane_type).order - laneConfig(b.lane_type).order);

    const stdRow = lanes.find(r => (r.lane_type || "STANDARD") === "STANDARD") || lanes[0];
    const tier = waitTier(stdRow.wait_minutes);
    const cfg = TIER_CONFIG[tier];

    let bigNumHtml;
    const mins = fmtMinutes(stdRow.wait_minutes);
    if (mins === null) {
        bigNumHtml = `<span class="text-5xl font-headline font-bold text-surface-variant tracking-tighter">--</span>`;
    } else if (mins === 0) {
        bigNumHtml = `<span class="text-5xl font-headline font-bold ${cfg.text} tracking-tighter">&lt;1<span class="text-xl ml-1 ${cfg.text}">M</span></span>`;
    } else {
        bigNumHtml = `<span class="text-6xl font-headline font-bold ${cfg.text} tracking-tighter leading-none">${mins}<span class="text-xl ml-1">M</span></span>`;
    }

    const laneRowsHtml = lanes.length > 1 ? lanes.map(row => {
        const lCfg = laneConfig(row.lane_type);
        const lTier = TIER_CONFIG[waitTier(row.wait_minutes)];
        const lMins = fmtMinutes(row.wait_minutes);
        let lText = lMins === null ? "Closed" : (lMins === 0 ? "<1m" : `${lMins}m`);

        return `<div class="flex justify-between items-center py-2 border-t border-[#3a494b]/20">
            <span class="px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${lCfg.cls}">${lCfg.label}</span>
            <span class="text-xs font-headline font-bold ${lTier.text}">${lText}</span>
        </div>`;
    }).join("") : "";

    const block = document.createElement("div");
    block.className = `bg-surface-container-high ${cfg.bg} p-8 flex flex-col justify-between relative overflow-hidden group ${cfg.border}`;

    // Watermark
    const waterMark = document.createElement("div");
    waterMark.className = `absolute top-0 right-0 p-4 opacity-[0.03] text-6xl font-bold font-headline select-none`;
    waterMark.textContent = cpName.substring(0, 3).toUpperCase();

    block.innerHTML = `
        ${waterMark.outerHTML}
        <h3 class="text-secondary-fixed-dim text-[10px] tracking-[0.2em] font-bold uppercase mb-8 pr-4 break-words leading-tight h-8">${cpName}</h3>
        <div>
            <div class="flex items-baseline mb-4">${bigNumHtml}</div>
            <p class="${cfg.text} text-[10px] flex items-center gap-1 uppercase tracking-widest mb-4">
                <span class="material-symbols-outlined text-xs">${cfg.icon}</span> ${cfg.label}
            </p>
            ${laneRowsHtml}
        </div>
    `;
    host.appendChild(block);
  });

  const updatedAt = latestCapturedAt(rows);
  if (updatedAt) {
      const tsEl = document.getElementById("selection-summary");
      if (tsEl) {
          tsEl.style.display = "block";
          tsEl.className = "text-[10px] text-secondary opacity-60 uppercase tracking-widest mt-2";
          tsEl.textContent = `LAST SYNC: ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
  }
}

function renderPipeline(rows) {
  const host = document.getElementById("pipeline-list");
  if (!host) return;
  host.innerHTML = "";
  rows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "bg-surface-container-high p-4 flex items-center gap-4";
    el.innerHTML = `
      <div class="p-3 bg-[#37374f] text-[#88d1e7]">
        <span class="material-symbols-outlined text-xl">construction</span>
      </div>
      <div class="flex-1">
        <h4 class="text-xs font-bold font-headline text-primary mb-1 uppercase tracking-widest">${row.code}</h4>
        <p class="text-[10px] text-secondary-fixed-dim opacity-60 uppercase tracking-widest">${row.name}</p>
      </div>
      <div class="px-2 py-1 bg-surface-container-highest text-[#88d1e7] text-[10px] font-bold uppercase tracking-widest border border-[#88d1e7]/20">
          Research
      </div>
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
  if (!ctx) return;
  if (chart) chart.destroy();

  Chart.defaults.font.family = "'Space Grotesk', sans-serif";
  Chart.defaults.color = "#88d1e7";

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: points.map((p) => p.label),
      datasets: [{
        label: `Avg Wait`,
        data: points.map((p) => p.value),
        backgroundColor: "rgba(0, 242, 255, 0.4)",
        hoverBackgroundColor: "rgba(0, 242, 255, 0.8)",
        borderWidth: 0,
        borderRadius: 2
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { font: { size: 10, weight: 'bold' }, maxTicksLimit: 8 },
          grid: { display: false }
        },
        y: {
          ticks: { font: { size: 10, weight: 'bold' } },
          grid: { color: "rgba(58, 73, 75, 0.15)", borderDash: [2, 4] },
          beginAtZero: true
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: "#191930",
            titleColor: "#00f2ff",
            bodyColor: "#e1fdff",
            borderColor: "#3a494b",
            borderWidth: 1,
            cornerRadius: 0,
            padding: 10,
            displayColors: false,
            callbacks: {
                label: function(context) { return context.parsed.y + ' MIN'; }
            }
        }
      },
    },
  });
}

async function loadHistory(airportCode) {
  const emptyEl = document.getElementById("chart-empty");
  if (!airportCode) {
    if (chart) { chart.destroy(); chart = null; }
    if(emptyEl) emptyEl.style.display = "block";
    return;
  }
  const resp = await fetch(`/api/history?airport=${airportCode}&hours=12`);
  const payload = await resp.json();
  const points = normalizeHistory(payload.rows || []);
  if(emptyEl) emptyEl.style.display = points.length ? "none" : "block";
  if (points.length) drawChart(points, airportCode);
}

function sourceStatusLabel(sourceType) {
  if (sourceType === "live_direct")        return ["• LIVE FEED", "text-[#00f2ff] animate-pulse"];
  if (sourceType === "estimated_fallback") return ["• ESTIMATED (FALLBACK)", "text-orange-400"];
  return ["", ""];
}

async function updateSelectionSourceStatus(airportCode) {
  const el = document.getElementById("selection-source-status");
  if (!el) return;
  if (!airportCode) { el.textContent = ""; el.className = "selection-source-status"; return; }
  try {
    const resp = await fetch(`/api/tsa-wait-times?code=${airportCode}`);
    const payload = await resp.json();
    const [label, cls] = sourceStatusLabel(payload.sourceType);
    el.textContent = label;
    el.className = `selection-source-status text-[10px] font-bold tracking-[0.2em] uppercase ${cls}`;
  } catch (_e) {
    el.textContent = "";
  }
}

function renderAirportChips(payload, filterText = "") {
  const host = document.getElementById("airport-chips");
  if (!host) return;
  host.innerHTML = "";

  const data = payload.data || {};
  const entries = Object.entries(payload.live_airports || {});
  const q = filterText.trim().toLowerCase();

  const filtered = entries.filter(([code, info]) =>
    !q || code.toLowerCase().includes(q) || info.name.toLowerCase().includes(q)
  );

  filtered.forEach(([code, info]) => {
    // Calculate aggregate standard wait for the tile
    const rows = data[code] || [];
    const active = rows.filter(r => Number(r.wait_minutes) > 0);
    const sample = active.length ? active : rows;
    const values = sample.map(r => Math.max(0, Number(r.wait_minutes)));
    const avgWait = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    const tier = waitTier(avgWait);
    const cfg = TIER_CONFIG[tier];

    let bigNumHtml = `<span class="text-3xl font-headline font-bold text-primary">${Math.round(avgWait)}<span class="text-sm ml-1 text-secondary opacity-50">MIN</span></span>`;
    if (avgWait === 0 && sample.length > 0) {
        bigNumHtml = `<span class="text-3xl font-headline font-bold text-primary">&lt;1<span class="text-sm ml-1 text-secondary opacity-50">MIN</span></span>`;
    }

    const card = document.createElement("div");
    card.className = `bg-surface-container-low p-6 ${cfg.border} hover:bg-surface-container-high transition-colors cursor-pointer flex flex-col justify-between`;
    card.onclick = () => window.location.href = `/airports/${code.toLowerCase()}-tsa-wait-times`;

    card.innerHTML = `
        <div>
            <div class="flex justify-between items-start mb-4">
                <span class="text-2xl font-headline font-bold text-primary leading-none">${code}</span>
                <span class="material-symbols-outlined ${cfg.text}">${cfg.icon}</span>
            </div>
            <div class="mb-6">
                <span class="text-[10px] text-secondary uppercase tracking-[0.2em] block mb-1">Status</span>
                <div class="flex items-center gap-2">
                    <div class="w-1.5 h-1.5 ${cfg.bg.split('/')[0].replace('bg-','bg-')} shadow-[0_0_8px_currentColor] ${cfg.text}"></div>
                    <span class="text-xs font-bold text-primary uppercase tracking-widest">${cfg.label}</span>
                </div>
            </div>
        </div>
        <div class="flex justify-between items-end mt-4">
            ${bigNumHtml}
            <button class="text-primary-container border-b border-primary-container/20 pb-0.5 text-[10px] font-bold uppercase tracking-widest hover:border-primary-container transition-all">Details</button>
        </div>
    `;
    host.appendChild(card);
  });
}

async function selectAirport(code) {
  selectedAirportCode = code;

  // Update chart dropdown
  const select = document.getElementById("airport-select");
  if (select) select.value = code;

  await updateSelectionSourceStatus(code);
  renderAirportChips(livePayloadCache, document.getElementById("airport-search")?.value || "");
  renderLiveCards(livePayloadCache, code);
  await loadHistory(code);
}

async function bootstrap() {
  try {
      const [liveResp, pipeResp] = await Promise.all([fetch("/api/live"), fetch("/api/pipeline")]);
      livePayloadCache = await liveResp.json();
      const pipePayload = await pipeResp.json();
      renderPipeline(pipePayload.airports || []);

      const search = document.getElementById("airport-search");
      if (search) {
          search.addEventListener("input", (e) => renderAirportChips(livePayloadCache, e.target.value));
          search.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            const q = search.value.trim().toLowerCase();
            const match = Object.keys(livePayloadCache.live_airports || {}).find(
              (c) => c.toLowerCase() === q || livePayloadCache.live_airports[c].name.toLowerCase().includes(q)
            );
            if (match) window.location.href = `/airports/${match.toLowerCase()}-tsa-wait-times`;
          });
      }

      renderAirportChips(livePayloadCache);

      const initialCode = String(window.INITIAL_AIRPORT_CODE || "").toUpperCase();
      if (initialCode && livePayloadCache.live_airports?.[initialCode]) {
        await selectAirport(initialCode);
      }
  } catch (e) {
      console.error("Bootstrap error", e);
  }
}

bootstrap();
