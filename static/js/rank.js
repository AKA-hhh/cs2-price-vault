// ═══════════════════════════════════════════════════════════
//  RANKING (排行榜)
// ═══════════════════════════════════════════════════════════

// $rankPage — 已提升至 core.js
const $rankTbody      = document.getElementById("rank-tbody");
const $rankPageInfo   = document.getElementById("rank-page-info");
const $rankPageBtns   = document.getElementById("rank-page-btns");
const $rankPrevBtn    = document.getElementById("rank-prev-btn");
const $rankNextBtn    = document.getElementById("rank-next-btn");
const $rankJumpInput  = document.getElementById("rank-jump-input");

let rankMainTab    = "price";   // price | hot | volume
let rankSubTab     = "price_up_rate";
let rankTime       = "1d";      // 时间范围: 1d/7d/15d/1m/3m/6m/1y
let rankCurPage    = 1;
const RANK_PAGE_SIZE = 20;

// ── 高级筛选状态 ──
let rankAdvFilter = {
  sell_min: 2,         // 价格最低价 (默认≥¥2)
  sell_max: null,      // 价格最高价
  buy_min: null,       // 求购最少
  buy_max: null,       // 求购最多
  sell_num_min: 100,    // 在售最少
  sell_num_max: null,   // 在售最多
  time: "1d",          // 时间范围
  order: "desc",       // desc | asc
  categories: ["normal"], // 类别
  type: [],            // 类型 (多选)
  quality: [],         // 品质
  wear: [],            // 磨损
};
let rankAdvActive = true;  // 默认开启 (sell_min=2)

// ── 时间范围 → 排序后缀 ──
const RANK_TIME_SUFFIX = {
  "1d": "近1天", "7d": "近7天", "15d": "近15天",
  "1m": "近1个月", "3m": "近3个月", "6m": "近6个月", "1y": "近1年",
};

// ── 子榜 → 排序前缀 ──
const RANK_SORT_PREFIX = {
  price_up_rate:   "价格_价格上升(百分比)_",
  price_down_rate: "价格_价格下降(百分比)_",
  price_up:        "价格_价格上升(金额)_",
  price_down:      "价格_价格下降(金额)_",
};

// 需要时间范围的子榜
const RANK_TIME_SUBS = new Set(["price_up_rate", "price_down_rate", "price_up", "price_down"]);

// ── 默认筛选参数 ──
const RANK_BASE_FILTER = {
  "在售最少": 100,
  "价格最低价": 2,
};

// ── 构建 filter ──
function getRankFilter() {
  let sortKey;
  const asc = (rankAdvFilter.order === "asc");
  if (rankMainTab === "price") {
    if (RANK_TIME_SUBS.has(rankSubTab)) {
      const prefix = RANK_SORT_PREFIX[rankSubTab];
      const suffix = RANK_TIME_SUFFIX[rankTime] || "近7天";
      sortKey = prefix + suffix;
    } else {
      const STATIC_SORTS = {
        sell_price:  asc ? "价格_售价_升序" : "价格_售价_降序",
        buy_price:   asc ? "价格_求购价_升序" : "价格_求购价_降序",
        market_cap:  asc ? "饰品总市值_总市值升序" : "饰品总市值_总市值降序",
      };
      sortKey = STATIC_SORTS[rankSubTab] || STATIC_SORTS.sell_price;
    }
  } else {
    const MAIN_SORTS = {
      hot:    "成交量_Steam日成交量",
      volume: "成交量_Steam日成交量",
    };
    sortKey = MAIN_SORTS[rankMainTab] || MAIN_SORTS.hot;
  }
  const extra = {};

  if (rankMainTab === "price" && RANK_TIME_SUBS.has(rankSubTab)) {
    // 品类
    if (rankAdvFilter.categories.length > 0) {
      extra["类别"] = rankAdvFilter.categories;
    }
    // 类型 (多选)
    if (rankAdvFilter.type.length > 0) {
      extra["类型"] = rankAdvFilter.type;
    }
    // 品质
    if (rankAdvFilter.quality.length > 0) {
      extra["品质"] = rankAdvFilter.quality;
    }
    // 磨损
    if (rankAdvFilter.wear.length > 0) {
      extra["磨损"] = rankAdvFilter.wear;
    }
    // 售价范围
    if (rankAdvFilter.sell_min != null && rankAdvFilter.sell_min > 0) {
      extra["价格最低价"] = rankAdvFilter.sell_min;
    }
    if (rankAdvFilter.sell_max != null) {
      extra["价格最高价"] = rankAdvFilter.sell_max;
    }
    // 求购范围
    if (rankAdvFilter.buy_min != null) {
      extra["求购最少"] = rankAdvFilter.buy_min;
    }
    if (rankAdvFilter.buy_max != null) {
      extra["求购最多"] = rankAdvFilter.buy_max;
    }
    // 在售数量范围
    if (rankAdvFilter.sell_num_min != null) {
      extra["在售最少"] = rankAdvFilter.sell_num_min;
    }
    if (rankAdvFilter.sell_num_max != null) {
      extra["在售最多"] = rankAdvFilter.sell_num_max;
    }
  }

  return { ...RANK_BASE_FILTER, ...extra, "排序": [sortKey] };
}

// ── 价格涨跌子榜显示时间范围和高级筛选按钮 ──
const $rankTimeSelect  = document.getElementById("rank-time-select");

function updateTimeRow() {
  const showBoth = (rankMainTab === "price" && RANK_TIME_SUBS.has(rankSubTab));
  const showTime = rankMainTab === "hot" || showBoth;
  if (showTime) show($rankTimeSelect); else hide($rankTimeSelect);
  if (showBoth) show($rankFilterBtn);   else hide($rankFilterBtn);
}

$rankTimeSelect.addEventListener("change", () => {
  rankTime = $rankTimeSelect.value;
  rankCurPage = 1;
  loadRankList();
});

// ── 动态计算表头 sticky 位置（参考库存页） ──
function updateRankTheadTop() {
  const sticky = document.querySelector(".rank-header");
  if (sticky) {
    document.documentElement.style.setProperty("--rank-thead-top", sticky.offsetHeight - 24 + "px");
  }
}

// ── Page nav ──
document.getElementById("btn-rank-page").addEventListener("click", showRankPage);

function showRankPage() {
  updateRankTheadTop();
  hide($dashboard);
  hide($watchlistPage);
  hide($kbPage);
  hide($promptsPage);
  hide($inventoryPage);
  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($rankPage);
  setActiveNav("btn-rank-page");
  activeAnalysisId = null;
  loadHistory(true);
  updateTimeRow();
  updateRankThead();
  loadRankList();
}

// ── Tab switching ──
document.getElementById("rank-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".rank-tab");
  if (!tab) return;
  rankMainTab = tab.dataset.rank;
  document.querySelectorAll(".rank-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");

  // 价格榜显示二级 tab + 时间范围（如果需要），其他隐藏
  const $subtabs = document.getElementById("rank-subtabs");
  if (rankMainTab === "price") {
    show($subtabs);
    rankSubTab = "price_up_rate";
    rankTime = "1d";
    rankAdvFilter = { sell_min: 2, sell_max: null, buy_min: null, buy_max: null, sell_num_min: 100, sell_num_max: null, time: "1d", order: "desc", categories: ["normal"], type: [], quality: [], wear: [] };
    rankAdvActive = true;
    updateFilterBtnState();
    $rankTimeSelect.value = "1d";
    // 恢复二级 tab 高亮
    document.querySelectorAll("#rank-subtabs .rank-subtab").forEach(t => t.classList.remove("active"));
    const activeSub = document.querySelector("#rank-subtabs .rank-subtab[data-sub=\"price_up_rate\"]");
    if (activeSub) activeSub.classList.add("active");
  } else {
    hide($subtabs);
    rankSubTab = rankMainTab;  // hot / volume
  }
  updateTimeRow();
  updateRankThead();
  rankCurPage = 1;
  loadRankList();
});

document.getElementById("rank-subtabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".rank-subtab");
  if (!tab) return;
  rankSubTab = tab.dataset.sub;
  document.querySelectorAll("#rank-subtabs .rank-subtab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  updateTimeRow();
  updateRankThead();
  rankCurPage = 1;
  loadRankList();
});

// ── 变动列头（¥ 显示金额，% 显示比率） ──
function updateChgHeader() {
  const $chgTh = document.getElementById("rank-chg-header");
  if ($chgTh) {
    const isAmount = (rankSubTab === "price_up" || rankSubTab === "price_down");
    $chgTh.textContent = isAmount ? "变动金额" : "变动率";
  }
}

// ── 成交量列（仅成交榜/热门榜显示） ──
function updateVolHeader() {
  const $volTh = document.getElementById("rank-vol-header");
  if ($volTh) {
    const show = (rankMainTab === "volume" || rankMainTab === "hot");
    $volTh.classList.toggle("hidden", !show);
  }
}

// ── Pagination events ──
$rankPrevBtn.addEventListener("click", () => { if (rankCurPage > 1) { rankCurPage--; loadRankList(); } });
$rankNextBtn.addEventListener("click", () => { rankCurPage++; loadRankList(); });
$rankJumpInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const p = parseInt($rankJumpInput.value);
    if (p >= 1) { rankCurPage = p; loadRankList(); }
    $rankJumpInput.value = "";
  }
});

// ── 高级筛选弹窗 ──
const $rankFilterModal  = document.getElementById("rank-filter-modal");
const $rankFilterBtn    = document.getElementById("rank-filter-btn");
const $rankFilterApply  = document.getElementById("rank-filter-apply");
const $rankFilterCancel = document.getElementById("rank-filter-cancel");
const $rankFilterReset  = document.getElementById("rank-filter-reset");
const $rankFilterClose  = document.getElementById("rank-filter-close");

function openRankFilter() {
  const f = rankAdvFilter;
  document.getElementById("rank-f-sell-min").value      = f.sell_min ?? "";
  document.getElementById("rank-f-sell-max").value      = f.sell_max ?? "";
  document.getElementById("rank-f-buy-min").value       = f.buy_min ?? "";
  document.getElementById("rank-f-buy-max").value       = f.buy_max ?? "";
  document.getElementById("rank-f-sell-num-min").value  = f.sell_num_min ?? "";
  document.getElementById("rank-f-sell-num-max").value  = f.sell_num_max ?? "";
  document.getElementById("rank-f-time").value          = f.time;
  document.getElementById("rank-f-order").value         = f.order;
  // 类型
  const types = f.type || [];
  const anyChecked = types.length === 0;
  document.getElementById("rank-f-type-any").checked = anyChecked;
  Object.entries(RANK_TYPE_MAP).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.checked = types.includes(val);
  });
  // 品类
  const cats = f.categories || ["normal"];
  document.getElementById("rank-f-cat-normal").checked          = cats.includes("normal");
  document.getElementById("rank-f-cat-strange").checked          = cats.includes("strange");
  document.getElementById("rank-f-cat-souvenir").checked         = cats.includes("souvenir");
  document.getElementById("rank-f-cat-unusual").checked          = cats.includes("unusual");
  document.getElementById("rank-f-cat-unusual-strange").checked  = cats.includes("unusual_strange");
  // 品质
  const qual = f.quality || [];
  document.getElementById("rank-f-qual-covert").checked      = qual.includes("违禁");
  document.getElementById("rank-f-qual-classified").checked   = qual.includes("隐秘");
  document.getElementById("rank-f-qual-restricted").checked   = qual.includes("保密");
  document.getElementById("rank-f-qual-mil").checked          = qual.includes("受限");
  document.getElementById("rank-f-qual-industrial").checked   = qual.includes("军规级");
  document.getElementById("rank-f-qual-consumer").checked     = qual.includes("工业级");
  document.getElementById("rank-f-qual-any").checked          = qual.length === 0;
  // 磨损
  const wear = f.wear || [];
  document.getElementById("rank-f-wear-fn").checked = wear.includes("崭新出厂");
  document.getElementById("rank-f-wear-mw").checked = wear.includes("略有磨损");
  document.getElementById("rank-f-wear-ft").checked = wear.includes("久经沙场");
  document.getElementById("rank-f-wear-ww").checked = wear.includes("破损不堪");
  document.getElementById("rank-f-wear-bs").checked = wear.includes("战痕累累");
  document.getElementById("rank-f-wear-any").checked = wear.length === 0;

  $rankFilterModal.classList.remove("hidden");
}

function closeRankFilter() { $rankFilterModal.classList.add("hidden"); }

function readChecked(prefix, valueMap) {
  const arr = [];
  for (const [id, val] of Object.entries(valueMap)) {
    if (document.getElementById(prefix + id).checked) arr.push(val);
  }
  return arr;
}

function applyRankFilter() {
  const g = (id) => document.getElementById(id).value;
  rankAdvFilter.sell_min      = g("rank-f-sell-min") !== "" ? parseFloat(g("rank-f-sell-min")) : null;
  rankAdvFilter.sell_max      = g("rank-f-sell-max") !== "" ? parseFloat(g("rank-f-sell-max")) : null;
  rankAdvFilter.buy_min       = g("rank-f-buy-min") !== "" ? parseFloat(g("rank-f-buy-min")) : null;
  rankAdvFilter.buy_max       = g("rank-f-buy-max") !== "" ? parseFloat(g("rank-f-buy-max")) : null;
  rankAdvFilter.sell_num_min  = g("rank-f-sell-num-min") !== "" ? parseInt(g("rank-f-sell-num-min")) : null;
  rankAdvFilter.sell_num_max  = g("rank-f-sell-num-max") !== "" ? parseInt(g("rank-f-sell-num-max")) : null;
  rankAdvFilter.time          = g("rank-f-time");
  rankAdvFilter.order         = g("rank-f-order");
  // 类型 (多选)
  rankAdvFilter.type = Object.entries(RANK_TYPE_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, val]) => val);
  rankAdvFilter.categories    = readChecked("rank-f-cat-", { "normal":"normal", "strange":"strange", "souvenir":"souvenir", "unusual":"unusual", "unusual-strange":"unusual_strange" });
  rankAdvFilter.quality       = readChecked("rank-f-qual-", { "covert":"违禁", "classified":"隐秘", "restricted":"保密", "mil":"受限", "industrial":"军规级", "consumer":"工业级" });
  rankAdvFilter.wear          = readChecked("rank-f-wear-", { "fn":"崭新出厂", "mw":"略有磨损", "ft":"久经沙场", "ww":"破损不堪", "bs":"战痕累累" });

  const f = rankAdvFilter;
  const isDefaultCats = f.categories.length === 1 && f.categories[0] === "normal";
  rankAdvActive = (
    (f.sell_min != null && f.sell_min !== 2) || f.sell_max != null ||
    f.buy_min != null || f.buy_max != null ||
    (f.sell_num_min != null && f.sell_num_min !== 100) || f.sell_num_max != null ||
    f.order !== "desc" || !isDefaultCats ||
    f.type.length > 0 || f.quality.length > 0 || f.wear.length > 0
  );

  // 同步高级筛选的时间到快捷时间下拉框，关闭弹窗后保持一致
  rankTime = rankAdvFilter.time;
  $rankTimeSelect.value = rankAdvFilter.time;

  updateFilterBtnState();
  closeRankFilter();
  rankCurPage = 1;
  loadRankList();
}

function resetRankFilter() {
  document.getElementById("rank-f-sell-min").value      = "";
  document.getElementById("rank-f-sell-max").value      = "";
  document.getElementById("rank-f-buy-min").value       = "";
  document.getElementById("rank-f-buy-max").value       = "";
  document.getElementById("rank-f-sell-num-min").value  = "100";
  document.getElementById("rank-f-sell-num-max").value  = "";
  document.getElementById("rank-f-time").value          = rankTime;
  document.getElementById("rank-f-order").value         = "desc";
  document.getElementById("rank-f-type-any").checked = true;
  Object.keys(RANK_TYPE_MAP).forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  document.querySelectorAll("#rank-filter-modal .rank-cat-check input[type=checkbox]").forEach(cb => {
    cb.checked = cb.id === "rank-f-cat-normal";
  });
  document.querySelectorAll("#rank-filter-modal input[id^='rank-f-qual-'], #rank-filter-modal input[id^='rank-f-wear-']").forEach(cb => { cb.checked = false; });
  document.getElementById("rank-f-qual-any").checked = true;
  document.getElementById("rank-f-wear-any").checked = true;
  rankAdvFilter = { sell_min: 2, sell_max: null, buy_min: null, buy_max: null, sell_num_min: 100, sell_num_max: null, time: rankTime, order: "desc", categories: ["normal"], type: [], quality: [], wear: [] };
  rankAdvActive = false;
  updateFilterBtnState();
  closeRankFilter();
  rankCurPage = 1;
  loadRankList();
}

function updateFilterBtnState() {
  $rankFilterBtn.classList.toggle("active", rankAdvActive);
}

$rankFilterBtn.addEventListener("click", openRankFilter);
$rankFilterClose.addEventListener("click", closeRankFilter);
$rankFilterCancel.addEventListener("click", closeRankFilter);
$rankFilterApply.addEventListener("click", applyRankFilter);
$rankFilterReset.addEventListener("click", resetRankFilter);
// ── 类型多选 ID → API 值映射 ──
const RANK_TYPE_MAP = {
  "rank-f-type-knife-all": "不限_匕首", "rank-f-type-bfk": "蝴蝶刀", "rank-f-type-m9": "M9 刺刀",
  "rank-f-type-karambit": "爪子刀", "rank-f-type-kukri": "廓尔喀刀", "rank-f-type-skeleton": "骷髅匕首",
  "rank-f-type-bayonet": "刺刀", "rank-f-type-talon": "锯齿爪刀", "rank-f-type-nomad": "流浪者匕首",
  "rank-f-type-flip": "折叠刀", "rank-f-type-stiletto": "短剑", "rank-f-type-seal": "海豹短刀",
  "rank-f-type-bear": "熊刀", "rank-f-type-huntsman": "猎杀者匕首", "rank-f-type-paracord": "系绳匕首",
  "rank-f-type-survival": "求生匕首", "rank-f-type-gut": "弯刀", "rank-f-type-shadow": "暗影双匕",
  "rank-f-type-bowie": "鲍伊猎刀", "rank-f-type-gut-knife": "穿肠刀", "rank-f-type-navaja": "折刀",
  "rank-f-type-glove-all": "不限_手套", "rank-f-type-sport": "运动手套", "rank-f-type-specialist": "专业手套",
  "rank-f-type-moto": "摩托手套", "rank-f-type-driver": "驾驶手套", "rank-f-type-handwrap": "手部束带",
  "rank-f-type-brokenfang": "狂牙手套", "rank-f-type-hydra": "九头蛇手套", "rank-f-type-bloodhound": "血猎手套",
  "rank-f-type-rifle-all": "不限_步枪", "rank-f-type-ak47": "AK-47", "rank-f-type-awp": "AWP",
  "rank-f-type-m4a1s": "M4A1 消音版", "rank-f-type-m4a4": "M4A4", "rank-f-type-aug": "AUG",
  "rank-f-type-sg553": "SG 553", "rank-f-type-famas": "法玛斯", "rank-f-type-galil": "加利尔 AR",
  "rank-f-type-scout": "SSG 08", "rank-f-type-scar20": "SCAR-20", "rank-f-type-g3sg1": "G3SG1",
  "rank-f-type-pistol-all": "不限_手枪", "rank-f-type-deagle": "沙漠之鹰", "rank-f-type-usps": "USP 消音版",
  "rank-f-type-glock": "格洛克 18 型", "rank-f-type-p2000": "P2000", "rank-f-type-p250": "P250",
  "rank-f-type-fn57": "FN57", "rank-f-type-revolver": "R8 左轮手枪", "rank-f-type-tec9": "Tec-9",
  "rank-f-type-dualies": "双持贝瑞塔", "rank-f-type-cz75": "CZ75 自动手枪", "rank-f-type-taser": "电击枪",
  "rank-f-type-smg-all": "不限_微型冲锋枪", "rank-f-type-mp9": "MP9", "rank-f-type-mac10": "MAC-10",
  "rank-f-type-ump45": "UMP-45", "rank-f-type-p90": "P90", "rank-f-type-mp7": "MP7",
  "rank-f-type-bizon": "PP-野牛", "rank-f-type-mp5sd": "MP5-SD", "rank-f-type-xm1014": "XM1014",
  "rank-f-type-mag7": "MAG-7", "rank-f-type-sawedoff": "截短霰弹枪", "rank-f-type-nova": "新星",
  "rank-f-type-m249": "M249", "rank-f-type-negev": "内格夫",
  "rank-f-type-case": "不限_武器箱", "rank-f-type-music": "音乐盒", "rank-f-type-sticker": "印花",
  "rank-f-type-tool": "工具", "rank-f-type-collection": "收藏品", "rank-f-type-patch": "布章",
  "rank-f-type-pass": "通行证", "rank-f-type-agent-all": "不限_探员",
  "rank-f-type-agent-ct": "反恐精英", "rank-f-type-agent-t": "恐怖分子",
};

// "全部XX" 勾选 → 自动勾选子项 / 取消亦然
$rankFilterModal.querySelectorAll("[data-type-cat]").forEach(cb => {
  cb.addEventListener("change", () => {
    const prefix = cb.id.replace("all-", "").replace(/-(knife|glove|rifle|pistol)$/, "-");
    const subs = $rankFilterModal.querySelectorAll(`#rank-f-type-${prefix} input[type=checkbox]:not(.rank-any-check):not([data-type-cat])`);
    // 由于 grid 布局不在单个 group 内，简化为查找同一列的其他 checkbox
    const col = cb.closest(".rank-type-col");
    if (col) {
      col.querySelectorAll("input[type=checkbox]:not([data-type-cat])").forEach(s => { s.checked = cb.checked; });
    }
    if (cb.checked) document.getElementById("rank-f-type-any").checked = false;
  });
});

// 子项变更 → 自动更新"全部XX"状态 + "不限"
$rankFilterModal.querySelectorAll(".rank-type-col input[type=checkbox]:not([data-type-cat])").forEach(cb => {
  cb.addEventListener("change", () => {
    if (cb.checked) document.getElementById("rank-f-type-any").checked = false;
    const col = cb.closest(".rank-type-col");
    if (col) {
      const cat = col.querySelector("[data-type-cat]");
      if (cat) {
        const subs = col.querySelectorAll("input[type=checkbox]:not([data-type-cat])");
        cat.checked = Array.from(subs).every(s => s.checked);
      }
    }
  });
});

// 品质/磨损"不限"互斥逻辑
$rankFilterModal.querySelectorAll(".rank-cat-checks[data-group]").forEach(group => {
  group.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type=checkbox]");
    if (!cb) return;
    const isAny = cb.classList.contains("rank-any-check");
    const checks = group.querySelectorAll("input[type=checkbox]");
    if (isAny && cb.checked) {
      // 选中"不限" → 取消所有具体选项
      checks.forEach(c => { if (!c.classList.contains("rank-any-check")) c.checked = false; });
    } else if (!isAny && cb.checked) {
      // 选中具体选项 → 取消"不限"
      group.querySelector(".rank-any-check").checked = false;
    } else if (!isAny && !cb.checked) {
      // 取消所有具体选项 → 自动勾选"不限"
      const anyChecked = Array.from(checks).some(c => !c.classList.contains("rank-any-check") && c.checked);
      if (!anyChecked) group.querySelector(".rank-any-check").checked = true;
    }
  });
});

// 点击遮罩关闭
$rankFilterModal.querySelector(".pf-modal-overlay").addEventListener("click", closeRankFilter);

// ── 表头动态切换 ──
function updateRankThead() {
  if (rankMainTab === "hot") {
    document.getElementById("rank-thead").innerHTML = `
      <tr>
        <th style="width:48px;">排行</th>
        <th>系列名称</th>
        <th style="width:88px;">15天走势</th>
        <th>饰品数量</th>
        <th>底价总值</th>
        <th>涨跌比率</th>
      </tr>`;
  } else {
    document.getElementById("rank-thead").innerHTML = `
      <tr>
        <th style="width:3.8%;">排行</th>
        <th style="width:38.5%;">饰品名称</th>
        <th style="width:11.5%;">30天走势</th>
        <th style="width:9.6%;">在售价格</th>
        <th style="width:9.6%;">求购价格</th>
        <th style="width:9.6%;">在售数量</th>
        <th id="rank-chg-header" style="width:9.6%;">变动率</th>
        <th id="rank-vol-header" class="hidden" style="width:7.7%;">日成交量</th>
      </tr>`;
    updateChgHeader();
    updateVolHeader();
  }
  setTimeout(updateRankTheadTop, 0);
}

// ── Load rank data ──
async function loadRankList() {
  const isHot = rankMainTab === "hot";
  const colspan = isHot ? "6" : "8";
  $rankTbody.innerHTML = `<tr><td colspan="${colspan}" class="rank-loading">加载中…</td></tr>`;

  // 热门榜走系列接口
  if (isHot) {
    await loadSeriesList();
    return;
  }

  const filter = getRankFilter();

  try {
    const r = await fetch("/api/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filter, page_index: rankCurPage, page_size: RANK_PAGE_SIZE }),
    });
    const data = await r.json();
    if (data.error) { $rankTbody.innerHTML = `<tr><td colspan="8" class="rank-empty">${escHtml(data.error)}</td></tr>`; return; }

    const items = data.data || [];
    if (!items.length) {
      $rankTbody.innerHTML = `<tr><td colspan="8" class="rank-empty">暂无数据</td></tr>`;
      $rankPageInfo.textContent = "共 0 条";
      $rankPrevBtn.disabled = true;
      $rankNextBtn.disabled = true;
      $rankPageBtns.innerHTML = "";
      return;
    }

    const hasMore = items.length >= RANK_PAGE_SIZE;
    const sortMsg = data._msg || "";
    $rankPageInfo.textContent = `第 ${rankCurPage} 页 · ${items.length} 条` + (sortMsg ? ` · 排序: ${sortMsg}` : "");

    renderRankTable(items, data.recently_data);

    $rankPrevBtn.disabled = rankCurPage <= 1;
    $rankNextBtn.disabled = !hasMore;
    $rankPageBtns.innerHTML = "";
  } catch (e) {
    $rankTbody.innerHTML = `<tr><td colspan="8" class="rank-empty">网络错误</td></tr>`;
  }
}

// ── 热门系列 ──
async function loadSeriesList() {
  try {
    const r = await fetch("/api/rank/series", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await r.json();
    if (data.error) { $rankTbody.innerHTML = `<tr><td colspan="6" class="rank-empty">${escHtml(data.error)}</td></tr>`; return; }

    const items = data.data || [];
    if (!items.length) {
      $rankTbody.innerHTML = `<tr><td colspan="6" class="rank-empty">暂无数据</td></tr>`;
      $rankPageInfo.textContent = "共 0 条";
      return;
    }

    $rankPageInfo.textContent = `共 ${items.length} 条 · 排序: 热门系列`;
    renderSeriesTable(items);

    // 系列无分页
    $rankPrevBtn.disabled = true;
    $rankNextBtn.disabled = true;
    $rankPageBtns.innerHTML = "";
  } catch (e) {
    $rankTbody.innerHTML = `<tr><td colspan="6" class="rank-empty">网络错误</td></tr>`;
  }
}

function renderSeriesTable(items) {
  const periodMap = { "1d": "1", "7d": "7", "15d": "15", "1m": "30", "3m": "90", "6m": "180", "1y": "365" };
  const period = periodMap[rankTime] || "7";
  const rateField = `sell_price_${period}`;

  $rankTbody.innerHTML = items.map((item, idx) => {
    const imgUrl = item.img || "";
    const name = item.name || "";
    const rankNum = item.key || (idx + 1);
    const amount = item.amount != null ? item.amount.toLocaleString("zh-CN") : "—";
    const totalVal = item.total_value != null ? `¥${fmtNum(item.total_value)}` : "—";
    const rate = item[rateField];
    let rateHtml = "—", rateCls = "";
    if (rate != null) {
      const isUp = rate >= 0;
      rateCls = isUp ? "rank-change-up" : "rank-change-down";
      rateHtml = `${isUp ? "+" : ""}${rate.toFixed(1)}%`;
    }

    // 迷你走势图 (recently_data 是纯数字数组)
    let sparkHtml = `<span class="inv-spark-placeholder">&mdash;</span>`;
    const prices = item.recently_data;
    if (prices && Array.isArray(prices) && prices.length >= 2) {
      sparkHtml = drawRankSparkline(prices);
    }

    // s_type → 类别标签
    const typeMap = { 0: "匕首", 1: "武器", 2: "印花", 3: "其他", 4: "手套" };
    const typeLabel = typeMap[item.s_type] || "";

    return `
      <tr data-series-id="${item.id}">
        <td class="rank-col-num" style="color:var(--text-tertiary);">${rankNum}</td>
        <td class="rank-col-name">
          <div style="display:flex;align-items:center;gap:8px;">
            ${imgUrl ? `<img src="${escHtml(imgUrl)}" alt="" class="rank-icon" loading="lazy" onerror="this.style.display='none'">` : ""}
            <span class="rank-name" title="${escHtml(name)}">${escHtml(name)}</span>
            ${typeLabel ? `<span class="rank-type-tag">${typeLabel}</span>` : ""}
          </div>
        </td>
        <td class="rank-col-spark">${sparkHtml}</td>
        <td class="rank-col-num">${amount}</td>
        <td class="rank-col-num">${totalVal}</td>
        <td class="rank-col-num"><span class="${rateCls}">${rateHtml}</span></td>
      </tr>`;
  }).join("");
}

function renderRankTable(items, recentlyData) {
  $rankTbody.innerHTML = items.map((item, idx) => {
    const imgUrl = item.img || "";
    const name = item.name || "";
    const rankNum = (rankCurPage - 1) * RANK_PAGE_SIZE + idx + 1;
    const yyypSell = item.yyyp_sell_price != null ? `¥${fmtNum(item.yyyp_sell_price)}` : "—";
    const yyypBuy  = item.yyyp_buy_price  != null ? `¥${fmtNum(item.yyyp_buy_price)}`  : "—";
    const sellNum  = item.yyyp_sell_num != null ? item.yyyp_sell_num.toLocaleString("zh-CN") : "—";
    const steamVol = item.turnover_number != null ? item.turnover_number.toLocaleString("zh-CN") : "—";
    const showVol  = (rankMainTab === "volume" || rankMainTab === "hot");

    // 变化率 / 变化金额
    const periodMap = { "1d": "1", "7d": "7", "15d": "15", "1m": "30", "3m": "90", "6m": "180", "1y": "365" };
    const period = periodMap[rankTime] || "7";
    const isAmount = (rankSubTab === "price_up" || rankSubTab === "price_down");
    const rateField = `sell_price_rate_${period}`;
    const amountField = `sell_price_${period}`;

    let chg = null;
    let chgHtml = "—";
    let chgCls = "";
    if (rankMainTab === "price") {
      if (isAmount) {
        chg = item[amountField];
        if (chg != null) {
          const isUp = chg >= 0;
          chgCls = isUp ? "rank-change-up" : "rank-change-down";
          chgHtml = `${isUp ? "+" : ""}¥${fmtNum(Math.abs(chg))}`;
        }
      } else {
        chg = item[rateField];
        if (chg != null) {
          const isUp = chg >= 0;
          chgCls = isUp ? "rank-change-up" : "rank-change-down";
          chgHtml = `${isUp ? "+" : ""}${chg.toFixed(1)}%`;
        }
      }
    }
    if (chg == null) chg = item[rateField];
    if (chg == null) chg = item.sell_price_rate_7;
    if (chg == null) chg = item.sell_price_rate_1;

    // 迷你走势图
    let sparkHtml = `<span class="inv-spark-placeholder">&mdash;</span>`;
    if (recentlyData) {
      const prices = recentlyData[String(item.id)] || recentlyData[item.id];
      if (prices && Array.isArray(prices) && prices.length >= 2) {
        sparkHtml = drawRankSparkline(prices);
      }
    }

    return `
      <tr data-item-id="${item.id}">
        <td class="rank-col-num" style="color:var(--text-tertiary);">${rankNum}</td>
        <td class="rank-col-name">
          <div style="display:flex;align-items:center;gap:8px;">
            ${imgUrl ? `<img src="${escHtml(imgUrl)}" alt="" class="rank-icon" loading="lazy" onerror="this.style.display='none'">` : ""}
            <span class="rank-name" title="${escHtml(name)}">${escHtml(name)}</span>
          </div>
        </td>
        <td class="rank-col-spark">${sparkHtml}</td>
        <td class="rank-col-num">${yyypSell}</td>
        <td class="rank-col-num">${yyypBuy}</td>
        <td class="rank-col-num">${sellNum}</td>
        <td class="rank-col-num"><span class="${chgCls}">${chgHtml}</span></td>
        <td class="rank-col-num" style="${showVol ? '' : 'display:none;'}">${showVol ? steamVol : ""}</td>
      </tr>`;
  }).join("");

  // Click row → 填入搜索框，用户自行选择周期后手动分析
  $rankTbody.querySelectorAll("tr[data-item-id]").forEach(tr => {
    tr.addEventListener("click", () => {
      const itemId = tr.dataset.itemId;
      const itemName = tr.querySelector(".rank-name")?.textContent || "";
      if (itemId) {
        selectedItemId = itemId;
        selectedItemName = itemName;
        $searchInput.value = itemName;
        $btnAnalyze.disabled = false;
      }
    });
  });
}

// ── 迷你走势图 (复用到已有的 drawSparklineSvg 逻辑，但价格数据格式可能不同) ──
function drawRankSparkline(prices) {
  if (!prices || prices.length < 2) return "";
  // 适配 csqaq recently_data 格式: [{price, time}, ...] 或 [price, price, ...]
  const vals = prices.map(p => (typeof p === "object" ? (p.price || p.close || 0) : Number(p))).filter(v => !isNaN(v) && v > 0);
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
