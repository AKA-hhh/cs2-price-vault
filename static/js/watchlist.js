// ═══════════════════════════════════════════════════════════
//  WATCHLIST PAGE (自选页面)
// ═══════════════════════════════════════════════════════════

const $wlSearchInput   = document.getElementById("wl-search-input");
const $wlSearchResults = document.getElementById("wl-search-results");
const $wlTableBody     = document.getElementById("wl-table-body");
const $wlPageCount     = document.getElementById("wl-page-count");
const $wlRefreshBtn    = document.getElementById("btn-wl-refresh");
let wlSearchTimeout = null;

async function loadWatchlist() {
  try {
    const r = await fetch("/api/watchlist");
    const items = await r.json();
    renderWatchlistTable(items);
  } catch (e) { /* ignore */ }
}

function renderWatchlistTable(items) {
  $wlPageCount.textContent = items.length;
  if (!items.length) {
    $wlTableBody.innerHTML = '<tr class="wl-empty-row"><td colspan="9">暂无自选，在上方搜索添加</td></tr>';
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
      try { const d = new Date(w.added_at); addTime = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`; } catch(e) {}
    }
    return `<tr>
      <td class="wl-td-item">
        <img src="${w.img||''}" loading="lazy" onerror="this.style.display='none'">
        <span class="wl-td-name" title="${(w.name||'').replace(/"/g,'&quot;')}">${w.name||'ID:'+w.id}</span>
      </td>
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
      renderWatchlistTable(items);
    }
  } catch (e) { /* ignore */ }
});
