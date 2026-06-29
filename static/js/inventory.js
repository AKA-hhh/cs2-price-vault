// $promptsPage, $inventoryPage — 已提升至 core.js
const $invSubtitle     = document.getElementById("inv-subtitle");
const $btnInvBind      = document.getElementById("btn-inv-bind");
const $btnInvFetch     = document.getElementById("btn-inv-fetch");
const $btnInvPrices    = document.getElementById("btn-inv-prices");
const $invStatus       = document.getElementById("inv-status");
const $invUpdated      = document.getElementById("inv-updated");
const $invSummary      = document.getElementById("inv-summary");
const $invTotalCount   = document.getElementById("inv-total-count");
const $invTotalValue   = document.getElementById("inv-total-value");
const $invTotalCost    = document.getElementById("inv-total-cost");
const $invPnl          = document.getElementById("inv-pnl");
const $invFilters      = document.getElementById("inv-filters");
const $invTable        = document.getElementById("inv-table");
const $invTbody        = document.getElementById("inv-tbody");
const $invEmpty        = document.getElementById("inv-empty");
const $invBindModal    = document.getElementById("inv-bind-modal");
const $invBindInput    = document.getElementById("inv-bind-input");
const $invBindMsg      = document.getElementById("inv-bind-msg");
let invCurrentFilter   = "all";
let invAllItems        = [];  // 完整库存数据缓存
let invCurrentSteamId  = "";  // 当前绑定的 SteamID
let invCosts           = {};  // {assetid: cost_price}
let invSortKey         = "";    // 当前排序列
let invSortAsc         = true;  // 升序/降序

async function loadSortState() {
  try {
    const r = await fetch("/api/settings");
    const d = await r.json();
    const s = d.inv_sort || {};
    if (s.key) invSortKey = s.key;
    if (typeof s.asc === "boolean") invSortAsc = s.asc;
  } catch (e) { /* ignore */ }
}
function saveSortState() {
  fetch("/api/settings/inventory-sort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: invSortKey, asc: invSortAsc }),
  }).catch(() => {});
}
// 稀有度排序 (高→低)
const RARITY_RANK = {
  "稀有特殊物品": 10, "Rare Special Item": 10,
  "违禁品": 9, "Contraband": 9,
  "隐秘": 8, "Covert": 8,
  "保密": 7, "Classified": 7,
  "受限": 6, "Restricted": 6,
  "军规级": 5, "Mil-Spec Grade": 5,
  "工业级": 4, "Industrial Grade": 4,
  "消费级": 3, "Consumer Grade": 3,
  "基础级": 2, "Base Grade": 2,
  "非凡": 8, "Extraordinary": 8,
};
// 品质排序 (高→低)
const QUALITY_RANK = {
  "StatTrak™": 5, "Souvenir": 3, "纪念品": 3,
  "普通": 2, "Normal": 2,
  "不同寻常": 1, "Unusual": 1,
};
// 磨损排序 (FN→BS, 高→低)
const WEAR_RANK = {
  "Factory New": 5, "崭新出厂": 5,
  "Minimal Wear": 4, "略有磨损": 4,
  "Field-Tested": 3, "久经沙场": 3,
  "Well-Worn": 2, "破损不堪": 2,
  "Battle-Scarred": 1, "战痕累累": 1,
};

// ═══════════════════════════════════════════════════════════
//  STEAM INVENTORY (库存)
// ═══════════════════════════════════════════════════════════

document.getElementById("btn-inventory-page").addEventListener("click", showInventoryPage);

// ── 绑定弹窗 ──
$btnInvBind.addEventListener("click", () => { show($invBindModal); $invBindInput.focus(); });
document.getElementById("inv-bind-close").addEventListener("click", () => hide($invBindModal));
document.getElementById("inv-bind-cancel").addEventListener("click", () => hide($invBindModal));
$invBindModal.querySelector(".pf-modal-overlay").addEventListener("click", () => hide($invBindModal));

document.getElementById("inv-bind-confirm").addEventListener("click", async () => {
  const raw = $invBindInput.value.trim();
  if (!raw) { $invBindMsg.textContent = "请输入 Steam ID"; $invBindMsg.className = "settings-msg error"; return; }
  $invBindMsg.textContent = "正在验证…";
  try {
    const r = await fetch("/api/inventory/bind", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({steam_id:raw}) });
    const d = await r.json();
    if (d.ok) {
      invCurrentSteamId = d.steam_id;
      $invBindMsg.textContent = "";
      hide($invBindModal);
      onBound();
      fetchInventory();
    } else {
      $invBindMsg.textContent = d.error || "绑定失败";
      $invBindMsg.className = "settings-msg error";
    }
  } catch (e) {
    $invBindMsg.textContent = "网络错误";
    $invBindMsg.className = "settings-msg error";
  }
});

async function loadBinding() {
  try {
    const r = await fetch("/api/inventory/binding");
    const d = await r.json();
    if (d.steam_id) {
      invCurrentSteamId = d.steam_id;
      onBound();
    }
  } catch (e) { /* ignore */ }
}

function onBound() {
  show($btnInvFetch);
  $invSubtitle.innerHTML = `已绑定: <b>${escapeHTML(invCurrentSteamId)}</b>，<span id="btn-inv-bind" class="inv-bind-link">修改绑定</span> · 点击获取库存查看 CS2 饰品（需库存设为公开）`;
  // 重新绑定事件（innerHTML 重建了元素）
  document.getElementById("btn-inv-bind").addEventListener("click", () => { show($invBindModal); $invBindInput.focus(); });
}

// ── 页面入口 ──
function showInventoryPage() {
  hide($dashboard);
  hide($watchlistPage);
  hide($kbPage);
  hide($promptsPage);
  hide($rankPage);
  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($inventoryPage);
  setActiveNav("btn-inventory-page");
  activeAnalysisId = null;
  loadHistory(true);
  loadSortState().then(() => {
    loadBinding().then(() => {
      loadCachedInventory().then(() => {
      if (invCurrentSteamId) {
        fetchInventory().then(() => fetchInventoryPrices());
      }
    });
  });
  });
}

async function loadCachedInventory() {
  try {
    const r = await fetch("/api/inventory/cached");
    const d = await r.json();
    if (d.ok && d.items && d.items.length > 0) {
      invAllItems = d.items;
      invCosts = d.costs || {};
      renderInventory(d.items);
      recalcSummary();
      // 优先用持久化缓存的走势图立即渲染
      if (d.sparklines) {
        for (const [gid, prices] of Object.entries(d.sparklines)) {
          const svg = drawSparklineSvg(prices);
          if (svg) _sparklineSvg[gid] = svg;
        }
        applyCachedSparklines();
      }
      // 后台静默刷新（后端 12h TTL，命中缓存时不调 csqaq API）
      fetchAllSparklines();
      show($btnInvPrices);
      // 不显示时间戳 — 等 fetchInventory 成功后更新
    }
  } catch (e) { /* ignore */ }
}

$btnInvFetch.addEventListener("click", fetchInventory);
$btnInvPrices.addEventListener("click", fetchInventoryPrices);

async function fetchInventory() {
  if (!invCurrentSteamId) { show($invBindModal); return; }

  $invStatus.textContent = "正在获取库存…";
  $invStatus.className = "inv-status loading";
  $btnInvFetch.disabled = true;

  try {
    const r = await fetch("/api/inventory/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steam_id: invCurrentSteamId, force: true }),
    });
    const d = await r.json();

    if (!r.ok || d.error) {
      $invStatus.textContent = d.error || "获取失败";
      $invStatus.className = "inv-status error";
      $btnInvFetch.disabled = false;
      return;
    }

    invAllItems = d.items || [];
    invCosts = d.costs || {};
    renderInventory(invAllItems);
    recalcSummary();
    fetchAllSparklines();
    $invStatus.textContent = `已获取 ${invAllItems.length} 件物品 (${d.unique_count || 0} 种)，正在查询价格…`;
    $invStatus.className = "inv-status ok";
    $invUpdated.textContent = new Date().toLocaleString("zh-CN");
    show($btnInvPrices);
    show($invUpdated);
  } catch (e) {
    $invStatus.textContent = "网络错误: " + e.message;
    $invStatus.className = "inv-status error";
  } finally {
    $btnInvFetch.disabled = false;
  }
}

async function fetchInventoryPrices() {
  $btnInvPrices.disabled = true;
  $invStatus.textContent = "正在查询价格...";
  $invStatus.className = "inv-status loading";

  try {
    const r = await fetch("/api/inventory/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steam_id: invCurrentSteamId }),
    });
    const d = await r.json();

    if (!r.ok || d.error) {
      $invStatus.textContent = (d.error || "价格查询失败") + " (已获取库存)";
      $invStatus.className = "inv-status error";
      $btnInvPrices.disabled = false;
      return;
    }

    const prices = d.prices || {};
    for (const item of invAllItems) {
      const p = prices[item.market_hash_name];
      if (p) {
        item.price = p.price;
        item.buff_price = p.buff_price;
        item.yyyp_price = p.yyyp_price;
        item.steam_price = p.steam_price;
        item.item_id = p.item_id;
      }
    }

    renderInventory(invAllItems);
    recalcSummary();
    fetchAllSparklines();
    $invStatus.textContent = `已获取库存 (${invAllItems.length} 件), 估值 ¥${fmtNum(d.total_value)}`;
    $invStatus.className = "inv-status ok";
  } catch (e) {
    $invStatus.textContent = "价格查询网络错误: " + e.message;
    $invStatus.className = "inv-status error";
  } finally {
    $btnInvPrices.disabled = false;
  }
}

// ── 成本价编辑 ──
async function saveCost(assetid, cost) {
  try {
    const r = await fetch("/api/inventory/cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steam_id: invCurrentSteamId, assetid: assetid, cost: cost }),
    });
    const d = await r.json();
    if (d.ok) {
      recalcSummary();
    }
  } catch (e) { /* ignore */ }
}

function updateTheadTop() {
  const sticky = document.querySelector(".inv-sticky-top");
  if (sticky) {
    document.documentElement.style.setProperty("--inv-thead-top", sticky.offsetHeight - 24 + "px");
  }
}

function recalcSummary() {
  const grouped = groupByHash(invAllItems);
  let totalCost = 0, totalValue = 0;
  for (const item of grouped) {
    const c = invCosts[item.assetid] || 0;
    totalCost += c * (item.amount || 1);
    if (item.price != null) {
      totalValue += item.price * (item.amount || 1);
    }
  }
  $invTotalCount.textContent = `${grouped.length} 种 (${invAllItems.length} 件)`;
  $invTotalValue.textContent = "¥" + fmtNum(totalValue);
  $invTotalCost.textContent = "¥" + fmtNum(totalCost);
  const pnl = totalValue - totalCost;
  $invPnl.textContent = (pnl >= 0 ? "+" : "") + "¥" + fmtNum(pnl);
  $invPnl.style.color = pnl >= 0 ? "var(--cinnabar)" : "var(--malachite)";
  show($invSummary);
  show($invFilters);
  updateTheadTop();
}

function renderInventory(items) {
  $invTbody.innerHTML = "";
  if (!items || items.length === 0) {
    hide($invTable); hide($invSummary); hide($invFilters); show($invEmpty);
    return;
  }
  show($invTable); hide($invEmpty);

  const grouped = groupByHash(items);
  const filtered = filterInvItems(grouped);
  if (filtered.length === 0) {
    $invTbody.innerHTML = `<tr><td colspan="11" class="inv-no-match">没有匹配的筛选结果</td></tr>`;
    return;
  }

  // 预计算投入/市值/盈亏/盈亏率（排序和渲染都需要）
  for (const item of filtered) {
    const c = invCosts[item.assetid] || 0;
    const amt = item.amount || 1;
    const invest = c * amt;
    const mktval = (item.price != null) ? item.price * amt : null;
    const pnl = (mktval != null && c > 0) ? invest - mktval : null;
    item._invest = c > 0 ? invest : null;
    item._mktval = mktval;
    item._pnl = pnl;
    item._pnlPct = (pnl != null && invest > 0) ? (pnl / invest) * 100 : null;
  }

  // 排序
  if (invSortKey) {
    filtered.sort((a, b) => {
      let va, vb;
      switch (invSortKey) {
        case "amount":   va = a.amount || 1; vb = b.amount || 1; break;
        case "cost":     va = invCosts[a.assetid] || 0; vb = invCosts[b.assetid] || 0; break;
        case "price":    va = a.price != null ? a.price : -1; vb = b.price != null ? b.price : -1; break;
        case "invest":   va = a._invest != null ? a._invest : -Infinity; vb = b._invest != null ? b._invest : -Infinity; break;
        case "mktval":   va = a._mktval != null ? a._mktval : -Infinity; vb = b._mktval != null ? b._mktval : -Infinity; break;
        case "pnl":      va = a._pnl != null ? a._pnl : -Infinity; vb = b._pnl != null ? b._pnl : -Infinity; break;
        case "pnlpct":   va = a._pnlPct != null ? a._pnlPct : -Infinity; vb = b._pnlPct != null ? b._pnlPct : -Infinity; break;
        case "rarity":   va = RARITY_RANK[a.rarity] || 0; vb = RARITY_RANK[b.rarity] || 0; break;
        case "quality":  va = QUALITY_RANK[a.quality] || 0; vb = QUALITY_RANK[b.quality] || 0; break;
        case "wear":     va = WEAR_RANK[a.exterior_raw] || 0; vb = WEAR_RANK[b.exterior_raw] || 0; break;
        default: return 0;
      }
      if (va < vb) return invSortAsc ? -1 : 1;
      if (va > vb) return invSortAsc ? 1 : -1;
      return 0;
    });
  }

  filtered.forEach(item => {
    const tr = document.createElement("tr");
    tr.className = "inv-row";

    const rarityStyle = item.rarity_color ? `color:${item.rarity_color};font-weight:600;` : "";
    const wearClass = getWearClass(item.exterior_raw);

    // 多平台价格 tooltip
    let priceTitle = "";
    if (item.price != null) {
      const parts = [];
      if (item.buff_price != null) parts.push(`Buff: ¥${fmtNum(item.buff_price)}`);
      if (item.yyyp_price != null) parts.push(`悠悠: ¥${fmtNum(item.yyyp_price)}`);
      if (item.steam_price != null) parts.push(`Steam: ¥${fmtNum(item.steam_price)}`);
      priceTitle = parts.length > 0 ? ` title="${parts.join(" | ")}"` : "";
    }
    const priceHtml = item.price != null
      ? `<span class="inv-price"${priceTitle}>¥${fmtNum(item.price)}</span>`
      : `<span class="inv-no-price">—</span>`;

    // 投入 = 成本价 × 数量, 市值 = 参考价 × 数量
    const cost = invCosts[item.assetid] || 0;
    const amount = item.amount || 1;
    const invest = cost * amount;
    const mktval = (item.price != null) ? item.price * amount : null;
    const pnl = (mktval != null && cost > 0) ? invest - mktval : null;
    const pnlPct = (pnl != null && invest > 0) ? (pnl / invest) * 100 : null;

    item._invest = cost > 0 ? invest : null;
    item._mktval = mktval;
    item._pnl = pnl;
    item._pnlPct = pnlPct;

    const investHtml = cost > 0 ? `<span class="inv-price">¥${fmtNum(invest)}</span>` : `<span class="inv-no-price">—</span>`;
    const mktvalHtml = mktval != null ? `<span class="inv-price">¥${fmtNum(mktval)}</span>` : `<span class="inv-no-price">—</span>`;

    let pnlHtml = `<span class="inv-no-price">—</span>`;
    let pnlPctHtml = `<span class="inv-no-price">—</span>`;
    if (pnl != null) {
      // 赚=红(cinnabar), 亏=绿(malachite) — 投入>市值=亏损, 投入<市值=盈利
      const isUp = pnl <= 0;  // 盈利=赚=红
      const cls = "inv-change " + (isUp ? "up" : "down");
      const sign = isUp ? "+" : "-";
      pnlHtml = `<span class="${cls}">${sign}¥${fmtNum(Math.abs(pnl))}</span>`;
      pnlPctHtml = `<span class="${cls}">${sign}${Math.abs(pnlPct).toFixed(1)}%</span>`;
    }

    const badges = [];
    if (!item.tradable) badges.push(`<span class="inv-badge inv-badge-locked" title="不可交易">&#128274;</span>`);
    if (!item.marketable) badges.push(`<span class="inv-badge inv-badge-nomarket" title="不可市场">&#128683;</span>`);

    // 成本价
    const curCost = invCosts[item.assetid] != null ? invCosts[item.assetid] : "";
    const costInput = `<input type="number" step="0.01" min="0" class="inv-cost-input" data-assetid="${escapeHTML(item.assetid || '')}" value="${curCost}" placeholder="—">`;

    tr.innerHTML = `
      <td class="inv-col-icon"><div class="inv-icon-wrap"><img src="${escapeHTML(item.icon_url)}" alt="" class="inv-icon" loading="lazy" onerror="this.style.display='none'">${amount > 1 ? `<span class="inv-qty-badge">${amount}</span>` : ""}</div></td>
      <td class="inv-col-name">
        <span class="inv-name">${escapeHTML(item.name_cn || item.name || item.market_hash_name)}</span>
        ${badges.length ? '<span class="inv-badges">' + badges.join("") + '</span>' : ""}
      </td>
	      <td class="inv-col-spark" data-spark-id="${escapeHTML(String(item.item_id || ''))}"><span class="inv-spark-placeholder">&mdash;</span></td>
      <td><span class="inv-wear ${wearClass}">${escapeHTML(item.exterior || "—")}</span></td>
      <td><span style="${rarityStyle}">${escapeHTML(item.rarity || "—")}</span></td>
      <td class="inv-col-num">${costInput}</td>
      <td class="inv-col-num">${priceHtml}</td>
      <td class="inv-col-num">${investHtml}</td>
      <td class="inv-col-num">${mktvalHtml}</td>
      <td class="inv-col-num">${pnlHtml}</td>
      <td class="inv-col-num">${pnlPctHtml}</td>
    `;
    $invTbody.appendChild(tr);
  });

  // 绑定成本价输入事件
  $invTbody.querySelectorAll(".inv-cost-input").forEach(inp => {
    inp.addEventListener("change", function() {
      const aid = this.dataset.assetid;
      const v = this.value.trim();
      invCosts[aid] = v ? parseFloat(v) : 0;
      if (!v) delete invCosts[aid];
      saveCost(aid, v || null);
      recalcSummary();
      renderInventory(invAllItems);
    });
  });

  updateSortHeaders();
  updateTheadTop();
  applyCachedSparklines();
}

function groupByHash(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.market_hash_name || item.name || item.assetid;
    if (map.has(key)) {
      const existing = map.get(key);
      existing.amount += item.amount || 1;
    } else {
      map.set(key, { ...item, amount: item.amount || 1 });
    }
  }
  return Array.from(map.values());
}

function getWearClass(exteriorRaw) {
  if (!exteriorRaw) return "";
  if (exteriorRaw.startsWith("Factory") || exteriorRaw === "WearCategory0") return "wear-fn";
  if (exteriorRaw.startsWith("Minimal") || exteriorRaw === "WearCategory1") return "wear-mw";
  if (exteriorRaw.startsWith("Field") || exteriorRaw === "WearCategory2") return "wear-ft";
  if (exteriorRaw.startsWith("Well") || exteriorRaw === "WearCategory3") return "wear-ww";
  if (exteriorRaw.startsWith("Battle") || exteriorRaw === "WearCategory4") return "wear-bs";
  return "";
}

function filterInvItems(items) {
  if (invCurrentFilter === "all") return items;
  if (invCurrentFilter === "priced") return items.filter(i => i.price != null);

  const typeMap = {
    pistol: ["Pistol"],
    rifle: ["Rifle", "Sniper Rifle", "Shotgun", "Machinegun"],
    smg: ["SMG"],
    heavy: ["Heavy", "Machinegun"],
    knife: ["Knife"],
    gloves: ["Gloves"],
    sticker: ["Sticker", "Music Kit", "Patch", "Collectible", "Pass", "Graffiti", "Key", "Tag", "Tool"],
    container: ["Container", "Crate", "Case", "Capsule", "Package", "Souvenir Package", "Gift", "Supply Crate"],
  };
  const types = typeMap[invCurrentFilter] || [];
  return items.filter(i => types.includes(i.type));
}

// ── 筛选按钮事件 ──
$invFilters.addEventListener("click", (e) => {
  const chip = e.target.closest(".inv-filter-chip");
  if (!chip) return;
  $invFilters.querySelectorAll(".inv-filter-chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  invCurrentFilter = chip.dataset.filter;
  renderInventory(invAllItems);
});

// ── 排序 ──
$invTable.querySelector("thead").addEventListener("click", (e) => {
  const th = e.target.closest("th.sortable");
  if (!th) return;
  const key = th.dataset.sort;
  if (!key) return;

  if (invSortKey === key) {
    invSortAsc = !invSortAsc;  // 同列切换升降序
  } else {
    invSortKey = key;
    invSortAsc = true;  // 新列默认升序
  }
  updateSortHeaders();
  saveSortState();
  renderInventory(invAllItems);
});

function updateSortHeaders() {
  $invTable.querySelectorAll("th.sortable").forEach(th => {
    th.classList.remove("active");
    const arrow = th.querySelector(".sort-arrow");
    if (arrow) { arrow.className = "sort-arrow"; }
  });
  if (!invSortKey) return;
  const activeTh = $invTable.querySelector(`th.sortable[data-sort="${invSortKey}"]`);
  if (activeTh) {
    activeTh.classList.add("active");
    const arrow = activeTh.querySelector(".sort-arrow");
    if (arrow) {
      arrow.className = `sort-arrow ${invSortAsc ? "asc" : "desc"}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  7-DAY SPARKLINE (迷你走势图)
// ═══════════════════════════════════════════════════════════

const _sparklineSvg = {};  // {item_id: svg_html} 缓存，排序/筛选后复用
let _sparklineFetching = false;  // 防止并发请求

function applyCachedSparklines() {
  for (const [gid, svg] of Object.entries(_sparklineSvg)) {
    document.querySelectorAll(`.inv-col-spark[data-spark-id="${gid}"]`).forEach(td => {
      td.innerHTML = svg;
    });
  }
}

function drawSparklineSvg(prices) {
  if (!prices || prices.length < 2) return "";
  const w = 80, h = 32, pad = 2;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const xs = prices.map((_, i) => pad + (i / (prices.length - 1)) * (w - pad * 2));
  const ys = prices.map(p => pad + (1 - (p - min) / range) * (h - pad * 2));
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const trend = prices[prices.length - 1] - prices[0];
  let cls = "inv-spark-flat";
  if (trend > 0) cls = "inv-spark-up";
  else if (trend < 0) cls = "inv-spark-down";
  return `<svg class="inv-spark ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

async function fetchAllSparklines() {
  if (_sparklineFetching) return;
  const seen = new Set();
  const ids = [];
  for (const item of invAllItems) {
    const gid = item.item_id;
    if (gid && !seen.has(gid)) {
      seen.add(gid);
      ids.push(gid);
    }
  }
  if (!ids.length) return;

  _sparklineFetching = true;
  try {
    const r = await fetch("/api/inventory/sparklines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_ids: ids, steam_id: invCurrentSteamId }),
    });
    const data = await r.json();
    const sparklines = data.sparklines || {};
    for (const [gid, prices] of Object.entries(sparklines)) {
      const svg = drawSparklineSvg(prices);
      if (svg) {
        _sparklineSvg[gid] = svg;
      }
    }
    // 立即应用到当前 DOM
    applyCachedSparklines();
  } catch (e) { /* ignore */ }
  _sparklineFetching = false;
}
