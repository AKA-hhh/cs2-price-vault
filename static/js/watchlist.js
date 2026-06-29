// ═══════════════════════════════════════════════════════════
//  WATCHLIST PAGE (自选页面)
// ═══════════════════════════════════════════════════════════

const $wlSearchInput   = document.getElementById("wl-search-input");
const $wlSearchResults = document.getElementById("wl-search-results");
const $wlTableBody     = document.getElementById("wl-table-body");
const $wlPageCount     = document.getElementById("wl-page-count");
const $wlRefreshBtn    = document.getElementById("btn-wl-refresh");
let wlSearchTimeout = null;
let wlCache = null;  // 列表数据缓存，切换页面时秒开
const _wlSparkCache = {};  // 走势图 SVG 缓存，避免重复请求

async function loadWatchlist() {
  if (wlCache) {
    renderWatchlistTable(wlCache);
    return;
  }
  try {
    const r = await fetch("/api/watchlist");
    const items = await r.json();
    wlCache = items;
    renderWatchlistTable(items);
  } catch (e) { /* ignore */ }
}

function updateWlCache(items) {
  wlCache = items;
  renderWatchlistTable(items);
}

function renderWatchlistTable(items) {
  $wlPageCount.textContent = items.length;
  if (!items.length) {
    $wlTableBody.innerHTML = '<tr class="wl-empty-row"><td colspan="10">暂无自选，在上方搜索添加</td></tr>';
    return;
  }
  $wlTableBody.innerHTML = items.map(w => {
    const chg1 = w.chg_1d || 0;
    const chg7 = w.chg_7d || 0;
    const chg30 = w.chg_30d || 0;
    const chg1Cls = chg1 >= 0 ? "up" : "down";
    const chg7Cls = chg7 >= 0 ? "up" : "down";
    const chg30Cls = chg30 >= 0 ? "up" : "down";
    const sign = (v) => v >= 0 ? "+" : "";
    let addTime = "";
    if (w.added_at) {
      try { const d = new Date(w.added_at); addTime = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch(e) {}
    }
    return `<tr>
      <td class="wl-td-item">
        <img src="${w.img||''}" loading="lazy" onerror="this.style.display='none'">
        <span class="wl-td-name" title="${(w.name||'').replace(/"/g,'&quot;')}">${w.name||'ID:'+w.id}</span>
      </td>
      <td class="wl-td-spark" data-wl-spark="${w.id}"><span class="inv-spark-placeholder">&mdash;</span></td>
      <td class="wl-td-price">¥${Number(w.price||0).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-price">¥${Number(w.buy_price||0).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-price">¥${Number(w.added_price||0).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-chg ${chg1Cls}">${sign(chg1)}${chg1.toFixed(1)}%</td>
      <td class="wl-td-chg ${chg7Cls}">${sign(chg7)}${chg7.toFixed(1)}%</td>
      <td class="wl-td-chg ${chg30Cls}">${sign(chg30)}${chg30.toFixed(1)}%</td>
      <td class="wl-td-num" style="font-size:0.65rem;color:var(--text-tertiary)">${addTime}</td>
      <td class="wl-td-del"><button data-remove="${w.id}" title="移除">✕</button></td>
    </tr>`;
  }).join("");

  // 先用缓存的走势图秒开
  applyWlSparkCache();
  // 后台刷新走势图（有缓存跳过）
  fetchWlSparklines(items.map(w => w.id));
}

function applyWlSparkCache() {
  for (const [gid, svg] of Object.entries(_wlSparkCache)) {
    const td = document.querySelector(`.wl-td-spark[data-wl-spark="${gid}"]`);
    if (td) td.innerHTML = svg;
  }
}

// ── Search to add ──
let wlSelectedItem = null;
const $btnWlAdd = document.getElementById("btn-wl-add");

$wlSearchInput.addEventListener("click", () => openIdmapModal("picker", $wlSearchInput));
$wlSearchInput.addEventListener("input", function() {
  clearTimeout(wlSearchTimeout);
  const q = this.value.trim();
  if (q.length < 2) { $wlSearchResults.innerHTML = ""; $btnWlAdd.disabled = true; wlSelectedItem = null; return; }
  wlSearchTimeout = setTimeout(async () => {
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({keyword: q}),
      });
      const d = await r.json();
      $wlSearchResults.innerHTML = (d.matches||[]).map(m =>
        `<div class="sr-item" data-id="${m.id}" data-name="${m.name.replace(/"/g,'&quot;')}">${m.name}</div>`
      ).join("");
      $btnWlAdd.disabled = true; wlSelectedItem = null;
    } catch (e) { $wlSearchResults.innerHTML = ""; }
  }, 300);
});

$wlSearchResults.addEventListener("click", async (e) => {
  const item = e.target.closest(".sr-item");
  if (!item) return;
  // 选中高亮
  $wlSearchResults.querySelectorAll(".sr-item").forEach(el => el.classList.remove("selected"));
  item.classList.add("selected");
  wlSelectedItem = { id: item.dataset.id, name: item.dataset.name };
  $btnWlAdd.disabled = false;
});

// 添加按钮
$btnWlAdd.addEventListener("click", async () => {
  if (!wlSelectedItem) return;
  try {
    const r = await fetch("/api/watchlist/add", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({item_id: wlSelectedItem.id, item_name: wlSelectedItem.name}),
    });
    if (r.ok) {
      $wlSearchInput.value = "";
      $wlSearchResults.innerHTML = "";
      $btnWlAdd.disabled = true;
      wlSelectedItem = null;
      wlCache = null;  // 列表已变，清缓存
      await loadWatchlist();
    } else if (r.status === 409) {
      const d = await r.json();
      alert(d.error || "已在自选列表中");
    }
  } catch (e) { /* ignore */ }
});

// ── Remove ──
$wlTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-remove]");
  if (!btn) return;
  const row = btn.closest("tr");
  const name = row?.querySelector(".wl-td-name")?.textContent || "此自选";
  const ok = await showConfirmDialog(`从自选移除「${name}」？`);
  if (!ok) return;
  const id = btn.dataset.remove;
  await fetch("/api/watchlist/remove", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({item_id: id}),
  });
  wlCache = null;  // 列表已变，清缓存
  await loadWatchlist();
  showToast("✓ 已移除");
});

// ── Refresh prices ──
$wlRefreshBtn.addEventListener("click", async () => {
  if ($wlRefreshBtn.classList.contains("spin")) return;
  $wlRefreshBtn.classList.add("spin");
  setTimeout(() => $wlRefreshBtn.classList.remove("spin"), 600);
  try {
    const r = await fetch("/api/watchlist/refresh", {method:"POST"});
    if (r.ok) {
      const items = await r.json();
      updateWlCache(items);
    }
  } catch (e) { /* ignore */ }
});

// ── 30天走势图 ──
async function fetchWlSparklines(ids) {
  if (!ids || ids.length === 0) return;
  // 总是拉全量最新数据，覆盖缓存保证准确性
  try {
    const r = await fetch("/api/watchlist/sparklines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_ids: ids }),
    });
    const d = await r.json();
    const sparklines = d.sparklines || {};
    for (const [gid, prices] of Object.entries(sparklines)) {
      const svg = drawWlSparkline(prices);
      if (svg) {
        _wlSparkCache[gid] = svg;
        const td = document.querySelector(`.wl-td-spark[data-wl-spark="${gid}"]`);
        if (td) td.innerHTML = svg;
      }
    }
  } catch (e) { /* ignore */ }
}

function drawWlSparkline(prices) {
  if (!prices || prices.length < 2) return "";
  const vals = prices.map(p => Number(p)).filter(v => !isNaN(v) && v > 0);
  if (vals.length < 2) return "";
  const w = 80, h = 30, pad = 2;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const xs = vals.map((_, i) => pad + (i / (vals.length - 1)) * (w - pad * 2));
  const ys = vals.map(v => pad + (1 - (v - min) / range) * (h - pad * 2));
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const trend = vals[vals.length - 1] - vals[0];
  let cls = "inv-spark-flat";
  if (trend > 0) cls = "inv-spark-up";
  else if (trend < 0) cls = "inv-spark-down";
  return `<svg class="inv-spark ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
