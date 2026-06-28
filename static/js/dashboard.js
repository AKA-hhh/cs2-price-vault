// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════

async function loadDashboard() {
  try {
    const r = await fetch("/api/market/overview");
    if (!r.ok) return;
    const d = await r.json();

    // ── 概览卡片 ──
    // 饰品指数 (取第一条)
    const indices = d.sub_index_data || [];
    if (indices.length) {
      const idx = indices[0];
      document.getElementById("dc-index").textContent = idx.close?.toFixed(2) || "--";
      const chg = idx.chg_rate || 0;
      const el = document.getElementById("dc-index-chg");
      el.textContent = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
      el.className = "dc-sub " + (chg >= 0 ? "up" : "down");
    }

    // 市场情绪
    const gs = d.greedy_status || {};
    document.getElementById("dc-sentiment").textContent = gs.label || "--";
    const slvl = document.getElementById("dc-sentiment-lvl");
    slvl.textContent = gs.level || "--";
    slvl.className = "dc-sub " + (gs.level === "high" ? "down" : gs.level === "low" ? "up" : "");

    // 在线人数
    const on = d.online_number || {};
    document.getElementById("dc-online").textContent = (on.current_number || 0).toLocaleString();
    const onChg = document.getElementById("dc-online-chg");
    const rate = on.rate || 0;
    onChg.textContent = (rate >= 0 ? "+" : "") + rate.toFixed(2) + "%";
    onChg.className = "dc-sub " + (rate >= 0 ? "up" : "down");

    // 涨跌统计 (近1日)
    const rd = d.rate_data || {};
    const up = rd.count_positive_1 || 0;
    const dn = rd.count_negative_1 || 0;
    const flat = rd.count_zero_1 || 0;
    document.getElementById("dc-rate").textContent = "↑" + up + " ↓" + dn;
    document.getElementById("dc-rate-sub").textContent = "平" + flat;

    // ── 饰品指数列表 ──
    renderIndexList(indices.slice(0, 12));

    // ── 异动数据 ──
    renderAlterations(d.alteration || []);

    // ── 大家都在看 ──
    renderViewCount(d.view_count || []);

  } catch (e) { /* ignore */ }
}

function renderIndexList(indices) {
  const el = document.getElementById("dash-indices");
  el.innerHTML = indices.map(i => {
    const chg = i.chg_rate || 0;
    const cls = chg >= 0 ? "up" : "down";
    const sign = chg >= 0 ? "+" : "";
    return `<div class="idx-row">
      <span class="idx-name">${i.name}</span>
      <span class="idx-val">${i.close?.toFixed(2)||"--"}</span>
      <span class="idx-chg ${cls}">${sign}${chg.toFixed(2)}%</span>
    </div>`;
  }).join("");
}

function renderAlterations(items) {
  const el = document.getElementById("dash-alterations");
  const top = items.slice(0, 15);
  el.innerHTML = top.map(a => {
    const diff = a.difference || 0;
    const cls = diff >= 0 ? "up" : "down";
    const sign = diff >= 0 ? "+" : "";
    const keyMap = {
      buff_sell_price: "在售价", buff_sell_num: "在售数",
      buff_buy_num: "求购数", yyyp_sell_price: "YY售价",
      yyyp_sell_num: "YY在售", yyyp_buy_num: "YY求购"
    };
    const keyLabel = keyMap[a.monitor_key] || a.monitor_key || "";
    const fullName = (a.name||"").replace(/"/g,"&quot;");
    return `<div class="alt-row" data-name="${fullName}" title="${fullName}" style="cursor:pointer;">
      <span class="alt-name">${a.name||""}</span>
      <span class="alt-key">${keyLabel}</span>
      <span class="alt-val">${a.origin||0}→${a.target||0}</span>
      <span class="alt-diff ${cls}">${sign}${diff}</span>
    </div>`;
  }).join("");
  if (!top.length) el.innerHTML = '<div class="empty-hint">暂无异动数据</div>';
}

function renderTypeDist(items) {
  const el = document.getElementById("dash-type-dist");
  const sorted = [...items].sort((a,b) => Math.abs(b.price_diff_1||0) - Math.abs(a.price_diff_1||0)).slice(0, 15);
  el.innerHTML = sorted.map(t => {
    const chg = t.price_diff_1 || 0;
    const cls = chg >= 0 ? "up" : "down";
    const barW = Math.min(100, Math.abs(chg) * 8);
    return `<div class="dist-row">
      <span class="dist-name">${t.name}</span>
      <span class="dist-bar-wrap"><span class="dist-bar ${cls}" style="width:${barW}%"></span></span>
      <span class="dist-val ${cls}">${chg>=0?"+":""}${chg.toFixed(1)}%</span>
    </div>`;
  }).join("");
}

function renderPriceDist(items) {
  const el = document.getElementById("dash-price-dist");
  const sorted = [...items].sort((a,b) => Math.abs(b.price_diff_1||0) - Math.abs(a.price_diff_1||0));
  el.innerHTML = sorted.map(t => {
    const chg = t.price_diff_1 || 0;
    const cls = chg >= 0 ? "up" : "down";
    const barW = Math.min(100, Math.abs(chg) * 10);
    return `<div class="dist-row">
      <span class="dist-name">${t.xKey || "未知"}</span>
      <span class="dist-bar-wrap"><span class="dist-bar ${cls}" style="width:${barW}%"></span></span>
      <span class="dist-val ${cls}">${chg>=0?"+":""}${chg.toFixed(1)}%</span>
    </div>`;
  }).join("");
}

function renderViewCount(items) {
  const el = document.getElementById("dash-viewcount");
  el.innerHTML = `<div class="vc-row">` + items.map(v => {
    const up = v.rank_num_change || 0;
    const arrow = up > 0 ? "▲" : up < 0 ? "▼" : "─";
    const cls = up > 0 ? "up" : up < 0 ? "down" : "";
    const fullName = (v.name||"").replace(/''/g, "'").replace(/"/g, '&quot;');
    return `<div class="vc-item" data-id="${v.id}" data-name="${fullName}" title="${fullName}">
      <img src="${v.img}" loading="lazy" onerror="this.style.display='none'">
      <span class="vc-name">${fullName}</span>
      <span class="vc-rank ${cls}">${arrow}${Math.abs(up)}</span>
    </div>`;
  }).join("") + `</div>`;
}

// ── 异动监测 click → 搜索匹配并填入分析框 ──
document.getElementById("dash-alterations")?.addEventListener("click", async function(e) {
  const item = e.target.closest(".alt-row");
  if (!item) return;
  const name = item.dataset.name;
  if (!name) return;
  // 通过搜索 API 获取 ID
  try {
    const r = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: name }),
    });
    const d = await r.json();
    if (d.matches && d.matches.length > 0) {
      selectedItemId = d.matches[0].id;
      selectedItemName = d.matches[0].name;
      document.getElementById("search-input").value = d.matches[0].name;
      document.getElementById("btn-analyze").disabled = false;
      document.getElementById("main-area").scrollTop = 0;
    }
  } catch (e) { /* ignore */ }
});

// ── Dashboard item click → jump to analysis ──
document.getElementById("dash-viewcount")?.addEventListener("click", function(e) {
  const item = e.target.closest(".vc-item");
  if (!item) return;
  const id = item.dataset.id;
  if (id) {
    selectedItemId = id;
    selectedItemName = item.dataset.name || item.getAttribute("title") || "";
    document.getElementById("search-input").value = selectedItemName;
    document.getElementById("btn-analyze").disabled = false;
    // scroll to top
    document.getElementById("main-area").scrollTop = 0;
  }
});
