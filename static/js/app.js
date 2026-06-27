/**
 * CS2 Skin Analyzer Terminal — Frontend Logic v2.0
 * Multi-session sidebar, trading terminal interactions
 */

// ── DOM refs ──
const $searchInput  = document.getElementById("search-input");
const $searchResults = document.getElementById("search-results");
const $periodPicker  = document.getElementById("period-picker");
const $btnAnalyze    = document.getElementById("btn-analyze");
const $historyList   = document.getElementById("history-list");
const $historyCount  = document.getElementById("history-count");
const $dashboard     = document.getElementById("dashboard");
const $loadingScreen   = document.getElementById("loading-screen");
const $loadingText     = document.getElementById("loading-text");
const $loadingItemName = document.getElementById("loading-item-name");
const $errorToast    = document.getElementById("error-toast");
const $resultsContainer = document.getElementById("results-container");
const $watchlistPage  = document.getElementById("watchlist-page");
const $chartImg      = document.getElementById("chart-img");
const $chartLabel    = document.getElementById("chart-label");
const $recDot         = document.getElementById("rec-dot");
const $recBadge       = document.getElementById("rec-badge");
const $gaugeFill      = document.getElementById("gauge-fill");
const $scoreValue     = document.getElementById("score-value");
const $recSummary     = document.getElementById("rec-summary");
const $recDetails     = document.getElementById("rec-details");
const $detailGrid     = document.getElementById("detail-grid");
const $aiContent      = document.getElementById("ai-content");
const $chatMessages   = document.getElementById("chat-messages");
const $chatInput      = document.getElementById("chat-input");
const $btnChatSend    = document.getElementById("btn-chat-send");
const $headerStatus   = document.getElementById("header-status");

// ── State ──
let selectedItemId   = null;
let selectedItemName  = null;
let selectedPeriodDays = 30;
let activeAnalysisId  = null;   // current active analysis ID
let searchTimeout     = null;
let isAnalyzing       = false;
let isChatting        = false;

// ── Helpers ──
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
const fmtNum = (n) => Number(n).toLocaleString("zh-CN", {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtPct = (n) => (n>=0?"+":"")+Number(n).toFixed(2)+"%";

function setStatus(online, text) {
  $headerStatus.className = "status-dot " + (online ? "online" : "offline");
  $headerStatus.title = text || "";
}

// ── Simple Markdown ──
function simpleMD(text) {
  if (!text) return "";
  return text
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/\n\n/g,"</p><p>")
    .replace(/\n/g,"<br>");
}

// ── Typewriter effect ──
function typewriterEffect(el, text, speed) {
  let i = 0;
  let rendered = "";
  el.textContent = "";
  const tick = () => {
    if (i >= text.length) {
      // Final render with markdown
      el.innerHTML = simpleMD(rendered);
      $chatMessages.scrollTop = $chatMessages.scrollHeight;
      return;
    }
    // Batch a few chars per tick for speed
    const batch = Math.min(3, text.length - i);
    rendered += text.substring(i, i + batch);
    el.textContent = rendered;
    $chatMessages.scrollTop = $chatMessages.scrollHeight;
    i += batch;
    setTimeout(tick, speed);
  };
  tick();
}

// ═══════════════════════════════════════════════════════════
//  SIDEBAR: History management
// ═══════════════════════════════════════════════════════════

async function loadHistory(keepActiveId) {
  try {
    const r = await fetch("/api/sessions");
    const data = await r.json();
    if (!keepActiveId) {
      activeAnalysisId = data.active_id;
    }
    // 保存 pending 项信息，renderHistory 会清空 innerHTML
    const pendingEl = document.getElementById("history-pending");
    const pendingName = pendingEl ? pendingEl.querySelector(".hi-name")?.textContent || "" : "";
    const pendingDays = pendingEl ? pendingEl.querySelector(".hi-period")?.textContent || "" : "";
    renderHistory(data.analyses || []);
    $historyCount.textContent = (data.analyses || []).length;
    // 恢复 pending 项
    if (pendingName) {
      prependPendingHistory(pendingName, pendingDays);
    }
  } catch (e) { /* ignore */ }
}

function renderHistory(analyses) {
  const scrollTop = $historyList.scrollTop; // 记住滚动位置
  if (!analyses.length) {
    $historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }
  $historyList.innerHTML = analyses.map(a => {
    const scoreCls = a.score >= 30 ? "positive" : a.score > -30 ? "neutral" : "negative";
    const isActive = a.id === activeAnalysisId && !$resultsContainer.classList.contains("hidden");
    const actionLabel = {strong_buy:"买入",buy:"买入",hold:"观望",sell:"卖出",strong_sell:"卖出"};
    const action = actionLabel[a.action] || "";
    const actionCls = a.action || "";
    return `
      <div class="history-item${isActive ? " active" : ""}" data-id="${a.id}">
        <div class="hi-name" title="${a.item_name}">${a.item_name}</div>
        <div class="hi-meta">
          <span class="hi-period">${a.period_days}D</span>
          <span class="hi-action ${actionCls}">${action}</span>
          <span class="hi-score ${scoreCls}">${a.score >= 0 ? "+" : ""}${a.score.toFixed(0)}</span>
        </div>
        <div class="hi-time">${a.time_str || ""}</div>
        <span class="hi-delete" data-delete="${a.id}" title="删除">&#10005;</span>
      </div>`;
  }).join("");
  $historyList.scrollTop = scrollTop; // 恢复滚动位置
}

$historyList.addEventListener("click", async (e) => {
  // Delete button
  const delBtn = e.target.closest(".hi-delete");
  if (delBtn) {
    e.stopPropagation();
    const aid = delBtn.dataset.delete;
    const hi = delBtn.closest(".history-item");
    const itemName = hi?.querySelector(".hi-name")?.textContent || "";
    const period = hi?.querySelector(".hi-period")?.textContent || "";
    const time = hi?.querySelector(".hi-time")?.textContent || "";
    const ok = await showConfirmDialog(`删除「${itemName}」\n${period} · ${time}`);
    if (!ok) return;
    const wasActive = (activeAnalysisId === aid);
    await fetch("/api/session/delete", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({analysis_id: aid}),
    });
    await loadHistory();
    showToast("✓ 已删除");
    // If the deleted was active, update right side
    if (wasActive) {
      const r = await fetch("/api/session/current");
      const d = await r.json();
      if (d.active) {
        activeAnalysisId = d.analysis_id;
        renderResults(d, true);
      } else {
        resetToWelcome();
      }
    }
    return;
  }

  // Click to switch
  const item = e.target.closest(".history-item");
  if (!item) return;
  const aid = item.dataset.id;
  if (!isAnalyzing && aid === activeAnalysisId && !$resultsContainer.classList.contains("hidden")) return;

  // 如果正在分析中，取消等候状态
  if (isAnalyzing) {
    hide($loadingScreen);
    const grid = $resultsContainer.querySelector(".analysis-grid");
    if (grid) grid.style.display = "";
  }

  setStatus(false, "加载中...");
  try {
    const r = await fetch("/api/session/switch", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({analysis_id: aid}),
    });
    const data = await r.json();
    if (r.ok && data.chart_b64) {
      activeAnalysisId = aid;
      renderResults(data, true);
      // 只更新 active 样式，不重建整个列表（避免滚动跳动）
      document.querySelectorAll(".history-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id === aid);
      });
    }
    setStatus(true, "就绪");
  } catch (e) {
    setStatus(false, "错误");
  }
});

// ═══════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════

$searchInput.addEventListener("input", function() {
  clearTimeout(searchTimeout);
  const kw = this.value.trim();
  if (kw.length < 2) {
    $searchResults.innerHTML = "";
    $btnAnalyze.disabled = true;
    selectedItemId = null; selectedItemName = null;
    return;
  }
  searchTimeout = setTimeout(() => doSearch(kw), 250);
});

$searchInput.addEventListener("keydown", function(e) {
  const items = $$(".search-item");
  if (!items.length) return;
  let idx = Array.from(items).findIndex(el => el.classList.contains("selected"));
  if (e.key === "ArrowDown") {
    e.preventDefault();
    idx = (idx + 1) % items.length;
    items.forEach(el => el.classList.remove("selected"));
    items[idx].classList.add("selected");
    items[idx].scrollIntoView({block:"nearest"});
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    idx = idx <= 0 ? items.length - 1 : idx - 1;
    items.forEach(el => el.classList.remove("selected"));
    items[idx].classList.add("selected");
    items[idx].scrollIntoView({block:"nearest"});
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (idx >= 0) items[idx].click();
  }
});

// Click search input → open ID map picker
$searchInput.addEventListener("click", () => openIdmapModal("picker", $searchInput));

$searchResults.addEventListener("click", function(e) {
  const item = e.target.closest(".search-item");
  if (!item) return;
  selectedItemId = item.dataset.id;
  selectedItemName = item.dataset.name;
  $searchInput.value = item.dataset.name;
  $searchResults.innerHTML = "";
  $btnAnalyze.disabled = false;
});

async function doSearch(keyword) {
  try {
    const r = await fetch("/api/search", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({keyword}),
    });
    const data = await r.json();
    const matches = data.matches || [];
    if (!matches.length) { $searchResults.innerHTML = ""; return; }
    $searchResults.innerHTML = matches.map((m,i) =>
      `<div class="search-item${i===0?" selected":""}" data-id="${m.id}" data-name="${m.name}">
         <span class="name">${m.name}</span>
         <span class="id">#${m.id}</span>
       </div>`
    ).join("");
    if (matches.length > 0 && !selectedItemId) {
      selectedItemId = matches[0].id;
      selectedItemName = matches[0].name;
      $btnAnalyze.disabled = false;
    }
  } catch(e) { /* ignore */ }
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Custom Confirm Dialog ──
function showConfirmDialog(msg) {
  return new Promise((resolve) => {
    const $dialog = document.getElementById("confirm-dialog");
    const $msg = document.getElementById("confirm-msg");
    $msg.innerHTML = msg.replace(/\n/g, "<br>");
    $dialog.classList.remove("hidden");
    const onClose = (result) => {
      $dialog.classList.add("hidden");
      cleanup();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Enter") onClose(true);
      if (e.key === "Escape") onClose(false);
    };
    const cleanup = () => {
      document.getElementById("btn-confirm-ok").removeEventListener("click", onOk);
      document.getElementById("btn-confirm-cancel").removeEventListener("click", onCancel);
      $dialog.querySelector(".pf-modal-overlay").removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
    };
    const onOk = () => onClose(true);
    const onCancel = () => onClose(false);
    document.getElementById("btn-confirm-ok").addEventListener("click", onOk);
    document.getElementById("btn-confirm-cancel").addEventListener("click", onCancel);
    $dialog.querySelector(".pf-modal-overlay").addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
    document.getElementById("btn-confirm-ok").focus();
  });
}

// ── Shared Toast ──
function showToast(msg) {
  const $toast = document.getElementById("pf-toast");
  $toast.textContent = msg;
  $toast.classList.remove("hidden");
  setTimeout(() => $toast.classList.add("hidden"), 2000);
}

// ── Period picker ──
const $btnCustomDays  = document.getElementById("btn-custom-days");
const $inputCustomDays = document.getElementById("input-custom-days");

$periodPicker.addEventListener("click", function(e) {
  if (e.target.tagName !== "BUTTON" || e.target === $btnCustomDays) return;
  $$("#period-picker button").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  selectedPeriodDays = parseInt(e.target.dataset.days);
  // 隐藏自定义输入
  $btnCustomDays.style.display = "";
  $inputCustomDays.style.display = "none";
});

// 自定义天数
$btnCustomDays.addEventListener("click", () => {
  $$("#period-picker button").forEach(b => b.classList.remove("active"));
  $btnCustomDays.classList.add("active");
  $btnCustomDays.style.display = "none";
  $inputCustomDays.style.display = "";
  $inputCustomDays.value = "";
  $inputCustomDays.focus();
  $btnAnalyze.disabled = true;
});

$inputCustomDays.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const days = parseInt($inputCustomDays.value);
    if (days >= 1 && days <= 730) {
      selectedPeriodDays = days;
      $btnCustomDays.textContent = days + "D";
      $btnCustomDays.dataset.days = days;
      $btnAnalyze.disabled = !selectedItemId;
    }
    $btnCustomDays.style.display = "";
    $inputCustomDays.style.display = "none";
  }
  if (e.key === "Escape") {
    $btnCustomDays.style.display = "";
    $inputCustomDays.style.display = "none";
  }
});

$inputCustomDays.addEventListener("blur", () => {
  // 延迟一下，让 Enter 事件先触发
  setTimeout(() => {
    const days = parseInt($inputCustomDays.value);
    if (days >= 1 && days <= 730) {
      selectedPeriodDays = days;
      $btnCustomDays.textContent = days + "D";
      $btnCustomDays.dataset.days = days;
    }
    $btnCustomDays.style.display = "";
    $inputCustomDays.style.display = "none";
  }, 150);
});

// ═══════════════════════════════════════════════════════════
//  ANALYZE
// ═══════════════════════════════════════════════════════════

// ── Page nav ──
document.getElementById("btn-dashboard").addEventListener("click", resetToWelcome);
document.getElementById("btn-watchlist-page").addEventListener("click", showWatchlistPage);
document.getElementById("btn-prompts-page").addEventListener("click", showPromptsPage);

function setActiveNav(activeId) {
  document.querySelectorAll(".btn-dash").forEach(b => {
    b.classList.toggle("active", b.id === activeId);
  });
}

function showWatchlistPage() {
  hide($dashboard);
  hide($portfolioPage);
  hide($kbPage);
  hide($promptsPage);

  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($watchlistPage);
  setActiveNav("btn-watchlist-page");
  loadHistory(); // 刷新侧边栏去掉高亮
  loadWatchlist().then(() => {
    // 后台自动刷新最新价格
    fetch("/api/watchlist/refresh", {method:"POST"}).then(r => r.json()).then(items => {
      renderWatchlistTable(items);
    }).catch(() => {});
  });
  activeAnalysisId = null;
}

function showPromptsPage() {
  hide($dashboard);
  hide($watchlistPage);
  hide($portfolioPage);
  hide($kbPage);

  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($promptsPage);
  setActiveNav("btn-prompts-page");
  loadHistory();
  loadPrompts();
  activeAnalysisId = null;
}

$btnAnalyze.addEventListener("click", runAnalysis);

async function runAnalysis() {
  if (!selectedItemId || isAnalyzing) return;
  isAnalyzing = true;

  hide($dashboard);
  hide($watchlistPage);
  hide($portfolioPage);
  hide($kbPage);
  hide($promptsPage);
  hide($errorToast);

  // 显示结果区 + 等候动画（同时显示，loading 盖在 grid 上面）
  show($resultsContainer);
  const analysisGrid = $resultsContainer.querySelector(".analysis-grid");
  if (analysisGrid) analysisGrid.style.display = "none";

  // 更新等候页面的饰品名
  $loadingItemName.textContent = selectedItemName || "";
  $loadingText.textContent = "正在获取数据…";
  $loadingText.style.opacity = "1";
  show($loadingScreen);

  // 立即在侧边栏顶部插入一条"分析中"占位
  prependPendingHistory(selectedItemName, selectedPeriodDays);

  $btnAnalyze.disabled = true;
  setStatus(true, "分析中...");

  // Loading text cycle with fade
  const loadingTexts = ["正在获取数据…", "计算技术指标…", "AI 多维分析…", "生成走势图表…"];
  let textIdx = 0;
  const textInterval = setInterval(() => {
    textIdx = (textIdx + 1) % loadingTexts.length;
    $loadingText.style.opacity = "0";
    setTimeout(() => {
      $loadingText.textContent = loadingTexts[textIdx];
      $loadingText.style.opacity = "1";
    }, 200);
  }, 2800);

  // 记录分析前的活跃ID，用于判断分析期间用户是否切换了
  const preActiveId = activeAnalysisId;

  try {
    const r = await fetch("/api/analyze", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({item_id: parseInt(selectedItemId), period_days: selectedPeriodDays}),
    });
    const data = await r.json();

    clearInterval(textInterval);

    if (!r.ok || data.error) {
      hide($resultsContainer);
      showError(data.error || "分析失败");
      setStatus(false, "错误");
      return;
    }

    // 如果分析期间用户切换了其他历史项，不覆盖当前页面
    const userSwitched = (preActiveId !== activeAnalysisId);
    if (!userSwitched) {
      renderResults(data, false);
      activeAnalysisId = data.analysis_id;
    }
    // 刷新侧边栏，keepActiveId=true 防止 loadHistory 覆盖 activeAnalysisId
    await loadHistory(true);
    setStatus(true, data.item_name);

    // Reset search selection for next query
    selectedItemId = null;
    selectedItemName = null;
    $searchInput.value = "";
  } catch (e) {
    clearInterval(textInterval);
    hide($resultsContainer);
    showError("网络请求失败，请检查连接");
    setStatus(false, "离线");
  } finally {
    hide($loadingScreen);
    if (analysisGrid) analysisGrid.style.display = "";
    // 移除 pending 项
    const pending = document.getElementById("history-pending");
    if (pending) pending.remove();
    isAnalyzing = false;
    $btnAnalyze.disabled = false;
  }
}

// ── 侧边栏顶部插入"分析中"占位项 ──
function prependPendingHistory(name, days) {
  const pendingEl = document.createElement("div");
  pendingEl.className = "history-item pending";
  pendingEl.id = "history-pending";
  pendingEl.innerHTML = `
    <div class="hi-name" title="${(name||"").replace(/"/g,"&quot;")}">${name||"分析中…"}</div>
    <div class="hi-meta">
      <span class="hi-period">${days}D</span>
      <span class="hi-action">分析中</span>
      <span class="hi-score neutral">…</span>
    </div>
    <div class="hi-time">进行中</div>
  `;
  // 移除旧的 pending 项
  const old = document.getElementById("history-pending");
  if (old) old.remove();
  if ($historyList.firstChild) {
    $historyList.insertBefore(pendingEl, $historyList.firstChild);
  } else {
    $historyList.appendChild(pendingEl);
  }
}

function renderResults(data, isSwitch) {
  hide($dashboard);
  hide($watchlistPage);
  hide($portfolioPage);
  hide($kbPage);
  hide($promptsPage);

  hide($loadingScreen);
  hide($errorToast);
  show($resultsContainer);
  setActiveNav(null);  // 分析结果页不属于任何导航页

  // ── Chart ──
  $chartImg.src = "data:image/png;base64," + data.chart_b64;
  // $chartLabel.textContent = (data.item_name||"") + " · " + (data.period_days||"") + "D";

  // ── Recommendation ──
  const rec = data.recommendation || {};
  const score = rec.score || 0;
  renderGauge(score);
  renderActionBadge(rec.action || "");
  $recSummary.textContent = rec.summary || "";
  $recDetails.innerHTML = (rec.details || []).map(d => `<li>${d}</li>`).join("");

  // ── Detail ──
  const detail = data.detail || {};
  const items = [];
  if (detail.yyyp_sell_price) items.push(["在售价","￥"+fmtNum(detail.yyyp_sell_price)]);
  if (detail.yyyp_buy_price) items.push(["求购价","￥"+fmtNum(detail.yyyp_buy_price)]);
  if (detail.sell_price_rate_7 != null) items.push(["7日涨跌",fmtPct(detail.sell_price_rate_7)]);
  if (detail.sell_price_rate_30 != null) items.push(["30日涨跌",fmtPct(detail.sell_price_rate_30)]);
  if (detail.yyyp_lease_num) items.push(["在租",detail.yyyp_lease_num+"件"]);
  if (detail.turnover_number) items.push(["Steam日成交",detail.turnover_number+"件"]);
  if (detail.statistic) items.push(["存世量",detail.statistic]);
  if (detail.exterior_localized_name) items.push(["磨损",detail.exterior_localized_name]);
  $detailGrid.innerHTML = items.map(i =>
    `<div class="detail-item"><div class="label">${i[0]}</div><div class="value">${i[1]}</div></div>`
  ).join("");

  // ── Chat (AI 分析作为第一条消息) ──
  $chatMessages.innerHTML = "";
  $chatInput.value = "";

  // AI 分析作为 AI 的第一条对话消息
  if (data.ai_analysis) {
    if (!isSwitch) {
      // 新分析：打字机效果
      const aiEl = appendMsg("assistant", "");
      const contentEl = aiEl.querySelector("div:last-child");
      typewriterEffect(contentEl, data.ai_analysis, 15);
    } else {
      // 切换历史：直接渲染
      appendMsg("assistant", data.ai_analysis);
    }
  } else if (data.ai_error) {
    appendMsg("assistant", "⚠️ " + data.ai_error);
  }

  // 渲染历史追问记录
  const chatMsgs = data.chat_messages || [];
  chatMsgs.forEach(m => {
    appendMsg(m.role === "user" ? "user" : "assistant", m.content);
  });

  if (!isSwitch) {
    $resultsContainer.scrollIntoView({behavior:"smooth"});
  }
}

function showError(msg) {
  hide($loadingScreen);
  hide($dashboard);
  hide($watchlistPage);
  hide($portfolioPage);
  hide($promptsPage);

  $errorToast.textContent = "✕ " + msg;
  show($errorToast);
  setTimeout(() => hide($errorToast), 8000);
}

function resetToWelcome() {
  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  hide($watchlistPage);
  hide($portfolioPage);
  hide($kbPage);
  hide($promptsPage);

  show($dashboard);
  setActiveNav("btn-dashboard");
  loadHistory(); // 刷新侧边栏去掉高亮
  $searchInput.value = "";
  selectedItemId = null; selectedItemName = null;
  activeAnalysisId = null;
  $btnAnalyze.disabled = true;
  $chatMessages.innerHTML = "";
  loadDashboard(); // 刷新大盘数据
}

// ── Score Gauge ──
function renderGauge(score) {
  // Normalize -100..100 to arc offset
  const clamped = Math.max(-100, Math.min(100, score));
  const pct = (clamped + 100) / 200; // 0..1
  const circumference = 141.37; // pi * 45 ≈ 141.37 (half-circle r=45)
  const offset = circumference * (1 - pct);

  $gaugeFill.style.strokeDashoffset = offset;

  let color;
  if (score >= 60) color = "var(--cinnabar)";
  else if (score >= 30) color = "#e05540";
  else if (score > -30) color = "var(--bronze)";
  else if (score > -60) color = "#3d9e7a";
  else color = "var(--malachite)";

  $gaugeFill.style.stroke = color;
  $scoreValue.style.color = color;
  $scoreValue.textContent = (score >= 0 ? "+" : "") + score.toFixed(0);

  // dot color (涨=红, 跌=绿)
  $recDot.className = "panel-dot";
  if (score >= 30) $recDot.classList.add("cinnabar");
  else if (score > -30) $recDot.classList.add("bronze");
  else $recDot.classList.add("malachite");
}

function renderActionBadge(action) {
  const map = {
    strong_buy: ["强烈买入","strong_buy"],
    buy: ["建议买入","buy"],
    hold: ["观望持有","hold"],
    sell: ["建议卖出","sell"],
    strong_sell: ["强烈卖出","strong_sell"],
  };
  const [label, cls] = map[action] || ["--",""];
  $recBadge.textContent = label;
  $recBadge.style.background = "";
  if (cls.includes("buy")) $recBadge.style.background = "var(--cinnabar-bg)";
  else if (cls.includes("sell")) $recBadge.style.background = "var(--malachite-bg)";
  else if (cls === "hold") $recBadge.style.background = "rgba(255,196,0,.08)";
}

// ═══════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════

$btnChatSend.addEventListener("click", sendChat);
$chatInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

async function sendChat() {
  const question = $chatInput.value.trim();
  if (!question || isChatting || !activeAnalysisId) return;

  isChatting = true;
  $btnChatSend.disabled = true;
  $chatInput.disabled = true;

  appendMsg("user", question);
  $chatInput.value = "";

  // 创建空的 AI 回复气泡，用于流式填充
  const aiEl = appendMsg("assistant", "");
  const aiContentEl = aiEl.querySelector("div:last-child");

  try {
    const r = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, analysis_id: activeAnalysisId }),
    });

    if (!r.ok) {
      aiContentEl.textContent = "✕ 请求失败 (HTTP " + r.status + ")";
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.error) {
            aiContentEl.textContent = "✕ " + chunk.error;
            return;
          }
          if (chunk.content) {
            fullText += chunk.content;
            aiContentEl.innerHTML = simpleMD(fullText);
            $chatMessages.scrollTop = $chatMessages.scrollHeight;
          }
          if (chunk.done) {
            // 流结束
          }
        } catch (e) { /* skip malformed chunks */ }
      }
    }
  } catch (e) {
    aiContentEl.textContent = "✕ 网络请求失败";
  } finally {
    isChatting = false;
    $btnChatSend.disabled = false;
    $chatInput.disabled = false;
    $chatInput.focus();
    // After streaming, refresh session list to persist the new messages
    loadHistory();
  }
}

function appendMsg(role, text) {
  const el = document.createElement("div");
  el.className = "chat-msg " + role;
  const label = role === "user" ? "YOU" : "AI";
  el.innerHTML = `<div class="msg-label">${label}</div><div>${simpleMD(text)}</div>`;
  $chatMessages.appendChild(el);
  $chatMessages.scrollTop = $chatMessages.scrollHeight;
  return el;
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════

const $btnSettings      = document.getElementById("btn-settings");
const $btnSettingsClose = document.getElementById("btn-settings-close");
const $settingsOverlay  = document.getElementById("settings-overlay");
const $settingsDrawer   = document.getElementById("settings-drawer");
const $btnSettingsSave  = document.getElementById("btn-settings-save");
const $settingsMsg      = document.getElementById("settings-msg");
const $html             = document.documentElement;

function openSettings() {
  hide($settingsMsg);
  show($settingsOverlay);
  show($settingsDrawer);
  loadSettings();
  loadMyIp();
  loadIdMapInfo();
}
function closeSettings() {
  hide($settingsOverlay);
  hide($settingsDrawer);
}

$btnSettings.addEventListener("click", openSettings);
$btnSettingsClose.addEventListener("click", closeSettings);
$settingsOverlay.addEventListener("click", closeSettings);

// Toggle buttons (theme, font-size)
document.querySelectorAll(".toggle-row").forEach(row => {
  row.addEventListener("click", function(e) {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    this.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Color buttons
document.querySelectorAll(".color-row").forEach(row => {
  row.addEventListener("click", function(e) {
    const btn = e.target.closest(".color-btn");
    if (!btn) return;
    this.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// ── Bind IP ──
const $btnBindIp = document.getElementById("btn-bind-ip");
const $bindIpResult = document.getElementById("bind-ip-result");
const $myLocalIp = document.getElementById("my-local-ip");
const $myPublicIp = document.getElementById("my-public-ip");

async function loadMyIp() {
	try {
		const r = await fetch("/api/settings/my-ip");
		const d = await r.json();
		$myLocalIp.textContent = d.local_ip || "--";
		$myPublicIp.textContent = d.public_ip || "--";
	} catch (e) {
		$myLocalIp.textContent = "获取失败";
		$myPublicIp.textContent = "获取失败";
	}
}

$btnBindIp.addEventListener("click", async () => {
	$btnBindIp.disabled = true;
	$btnBindIp.textContent = "绑定中...";
	$bindIpResult.textContent = "";
	$bindIpResult.className = "settings-msg";
	try {
		const r = await fetch("/api/settings/bind-ip", { method: "POST" });
		const d = await r.json();
		if (d.code === 200 || d.code === 0) {
			$bindIpResult.textContent = "✓ " + (d.msg || "IP 绑定成功");
			$bindIpResult.className = "settings-msg";
		} else {
			$bindIpResult.textContent = "✕ " + (d.msg || "绑定失败 (code=" + d.code + ")");
			$bindIpResult.className = "settings-msg error";
		}
	} catch (e) {
		$bindIpResult.textContent = "✕ 网络请求失败";
		$bindIpResult.className = "settings-msg error";
	} finally {
		$btnBindIp.disabled = false;
		$btnBindIp.textContent = "绑定当前 IP";
	}
});

// Range slider live display
document.querySelectorAll(".settings-range").forEach(slider => {
  const display = document.getElementById("val-" + slider.id.replace("set-", ""));
  if (display) {
    slider.addEventListener("input", () => { display.textContent = parseFloat(slider.value).toFixed(1); });
  }
});

// Eye toggle for password fields
document.querySelectorAll(".btn-eye").forEach(btn => {
  btn.addEventListener("click", function() {
    const targetId = this.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    this.classList.toggle("show", isPassword);
  });
});

async function loadSettings() {
  try {
    const r = await fetch("/api/settings");
    const d = await r.json();
    document.getElementById("set-api-token").value = d.api_token_masked || "";
    document.getElementById("set-deepseek-key").value = d.deepseek_key_masked || "";
    document.getElementById("set-deepseek-model").value = d.deepseek_model || "deepseek-v4-pro";
    document.getElementById("set-deepseek-chat-model").value = d.deepseek_chat_model || "deepseek-v4-flash";
    document.getElementById("set-ai-temperature").value = d.ai_temperature || "0";
    document.getElementById("val-ai-temperature").textContent = d.ai_temperature || "0";
    document.getElementById("set-chat-temperature").value = d.chat_temperature || "0";
    document.getElementById("val-chat-temperature").textContent = d.chat_temperature || "0";
    // Theme
    setToggle("set-theme", d.theme || "dark");
    setColor("set-accent", d.accent || "green");
    // Apply current theme to page
    applyTheme(d);
  } catch (e) { /* ignore */ }
}

function setToggle(rowId, value) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.querySelectorAll(".toggle-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.value === value);
  });
}

function setColor(rowId, value) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.querySelectorAll(".color-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.value === value);
  });
}

function applyTheme(d) {
  $html.dataset.theme = d.theme || "dark";
  $html.dataset.accent = d.accent || "green";
}

$btnSettingsSave.addEventListener("click", async () => {
  const apiToken = document.getElementById("set-api-token").value.trim();
  const dkKey = document.getElementById("set-deepseek-key").value.trim();
  const model = document.getElementById("set-deepseek-model").value;
  const chatModel = document.getElementById("set-deepseek-chat-model").value;
  // Read toggle/color selections
  const theme = document.querySelector("#set-theme .toggle-btn.active")?.dataset?.value || "dark";
  const accent = document.querySelector("#set-accent .color-btn.active")?.dataset?.value || "green";
  const aiTemp = document.getElementById("set-ai-temperature").value;
  const chatTemp = document.getElementById("set-chat-temperature").value;

  try {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_token: apiToken,
        deepseek_key: dkKey,
        deepseek_model: model,
        deepseek_chat_model: chatModel,
        ai_temperature: aiTemp,
        chat_temperature: chatTemp,
        theme, accent, font_size: "large",
      }),
    });
    const d = await r.json();
    if (d.ok) {
      // Apply live
      applyTheme({ theme, accent });
      $settingsMsg.textContent = "";
      showToast("✓ 设置已保存");
    }
  } catch (e) {
    $settingsMsg.textContent = "✕ 保存失败";
    $settingsMsg.className = "settings-msg error";
  }
});

// ── ID Map Upload ──
const $idmapFileInput    = document.getElementById("idmap-file-input");
const $idmapFilenameDisp = document.getElementById("idmap-filename-display");
const $btnIdmapUpload    = document.getElementById("btn-idmap-upload");
const $idmapUploadResult = document.getElementById("idmap-upload-result");
const $idmapCount        = document.getElementById("idmap-count");
const $idmapFilename     = document.getElementById("idmap-filename");
const $idmapSize         = document.getElementById("idmap-size");

async function loadIdMapInfo() {
  try {
    const r = await fetch("/api/settings/id-map/info");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    $idmapCount.textContent = d.item_count?.toLocaleString() || "0";
    $idmapFilename.textContent = d.filename || "--";
    $idmapSize.textContent = d.size_kb ? (d.size_kb + " KB") : "--";
  } catch (e) {
    $idmapCount.textContent = "加载失败";
    $idmapFilename.textContent = "加载失败";
    $idmapSize.textContent = "加载失败";
  }
}

const $idmapNewInfo    = document.getElementById("idmap-new-info");
const $idmapNewCount   = document.getElementById("idmap-new-count");
const $idmapNewFilename = document.getElementById("idmap-new-filename");
const $idmapNewSize    = document.getElementById("idmap-new-size");

$idmapFileInput.addEventListener("change", function() {
  const file = this.files[0];
  if (!file) {
    $idmapFilenameDisp.textContent = "未选择文件";
    $btnIdmapUpload.disabled = true;
    $idmapNewInfo.style.display = "none";
    return;
  }

  $idmapFilenameDisp.textContent = file.name;
  $btnIdmapUpload.disabled = false;
  $idmapUploadResult.textContent = "";
  $idmapUploadResult.className = "settings-msg";

  // Parse locally to show comparison
  $idmapNewFilename.textContent = file.name;
  $idmapNewSize.textContent = file.size > 1024 ? (file.size / 1024).toFixed(1) + " KB" : file.size + " B";
  $idmapNewCount.textContent = "解析中…";
  $idmapNewInfo.style.display = "flex";

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data)) {
        $idmapNewCount.textContent = data.length.toLocaleString();
      } else {
        $idmapNewCount.textContent = "格式错误";
      }
    } catch (_) {
      $idmapNewCount.textContent = "JSON 无效";
    }
  };
  reader.onerror = function() {
    $idmapNewCount.textContent = "读取失败";
  };
  reader.readAsText(file);
});

$btnIdmapUpload.addEventListener("click", async () => {
  const file = $idmapFileInput.files[0];
  if (!file) return;

  $btnIdmapUpload.disabled = true;
  $btnIdmapUpload.textContent = "上传中...";
  $idmapUploadResult.textContent = "";
  $idmapUploadResult.className = "settings-msg";

  try {
    const formData = new FormData();
    formData.append("file", file);

    const r = await fetch("/api/settings/id-map/upload", {
      method: "POST",
      body: formData,
    });
    const d = await r.json();

    if (d.ok) {
      $idmapUploadResult.textContent = "✓ 上传成功，已加载 " + d.item_count + " 个饰品";
      $idmapUploadResult.className = "settings-msg";
      showToast("✓ 品类数据已更新: " + d.item_count + " 个饰品");
      // Refresh info
      loadIdMapInfo();
      // Reset file input & hide comparison
      $idmapFileInput.value = "";
      $idmapFilenameDisp.textContent = "未选择文件";
      $idmapNewInfo.style.display = "none";
    } else {
      $idmapUploadResult.textContent = "✕ " + (d.error || "上传失败");
      $idmapUploadResult.className = "settings-msg error";
    }
  } catch (e) {
    $idmapUploadResult.textContent = "✕ 网络请求失败";
    $idmapUploadResult.className = "settings-msg error";
  } finally {
    $btnIdmapUpload.disabled = false;
    $btnIdmapUpload.textContent = "上传替换";
  }
});

// ── ID Map Preview Modal ──
const $idmapModal        = document.getElementById("idmap-modal");
const $idmapModalOverlay = $idmapModal.querySelector(".idmap-modal-overlay");
const $idmapModalClose   = document.getElementById("idmap-modal-close");
const $idmapSearchInput  = document.getElementById("idmap-search-input");
const $idmapModalInfo    = document.getElementById("idmap-modal-info");
const $idmapTableBody    = document.getElementById("idmap-table-body");
const $idmapPageInfo     = document.getElementById("idmap-page-info");
const $idmapPrevBtn      = document.getElementById("idmap-prev-btn");
const $idmapNextBtn      = document.getElementById("idmap-next-btn");
const $idmapPageBtns     = document.getElementById("idmap-page-btns");

let idmapPreviewOffset = 0;
const IDMAP_PAGE_SIZE = 30;
let idmapPreviewTotal = 0;
let idmapSearchTimer = null;
let idmapCurPage = 1;

let idmapMode = "view"; // "view" | "picker"
let idmapPickerTarget = null; // which input to fill in picker mode
const $idmapModalTitle = $idmapModal.querySelector("h3");

function closeIdmapModal() {
  $idmapModal.classList.add("hidden");
  idmapPickerTarget = null;
}

function openIdmapModal(mode, targetInput) {
  idmapMode = mode || "view";
  idmapPickerTarget = targetInput || null;
  $idmapModal.classList.remove("hidden");
  $idmapSearchInput.value = "";
  idmapPreviewOffset = 0;
  idmapCurPage = 1;
  if (idmapMode === "picker") {
    $idmapModalTitle.textContent = "选择饰品";
  } else {
    $idmapModalTitle.textContent = "饰品品类预览";
  }
  loadIdmapPreview();
}

[$idmapModalClose, $idmapModalOverlay].forEach(el =>
  el.addEventListener("click", closeIdmapModal)
);

$idmapFilename.addEventListener("click", () => openIdmapModal("view"));

// ── Search input ──
$idmapSearchInput.addEventListener("input", function() {
  clearTimeout(idmapSearchTimer);
  idmapSearchTimer = setTimeout(() => {
    idmapPreviewOffset = 0;
    idmapCurPage = 1;
    loadIdmapPreview();
  }, 250);
});

async function loadIdmapPreview() {
  const q = $idmapSearchInput.value.trim();
  const isSearch = q.length > 0;
  const url = isSearch
    ? `/api/settings/id-map/search?q=${encodeURIComponent(q)}&limit=${IDMAP_PAGE_SIZE}&offset=${idmapPreviewOffset}`
    : `/api/settings/id-map/preview?limit=${IDMAP_PAGE_SIZE}&offset=${idmapPreviewOffset}`;

  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    idmapPreviewTotal = d.total || 0;

    const start = d.offset + 1;
    const end = d.offset + (d.items ? d.items.length : 0);
    if (isSearch) {
      $idmapModalInfo.textContent = idmapPreviewTotal > 0
        ? `搜索 "${q}" — ${idmapPreviewTotal.toLocaleString()} 条结果，第 ${start}-${end} 条`
        : `搜索 "${q}" — 无结果`;
    } else {
      $idmapModalInfo.textContent = `共 ${idmapPreviewTotal.toLocaleString()} 条，第 ${start}-${end} 条`;
    }

    idmapCurPage = Math.floor(idmapPreviewOffset / IDMAP_PAGE_SIZE) + 1;
    const totalPages = Math.ceil(idmapPreviewTotal / IDMAP_PAGE_SIZE) || 1;

    renderPageButtons(idmapCurPage, totalPages);
    $idmapPrevBtn.disabled = idmapCurPage <= 1;
    $idmapNextBtn.disabled = idmapCurPage >= totalPages;

    const pickerClass = idmapMode === "picker" ? " idmap-picker-row" : "";
    $idmapTableBody.innerHTML = (d.items || []).map(item =>
      `<tr class="${pickerClass}" data-pick-id="${item.id}" data-pick-name="${escHtml(item.name || "")}"><td>${item.id}</td><td>${escHtml(item.name || "")}</td><td class="market-name">${escHtml(item.market_hash_name || "")}</td></tr>`
    ).join("");

    // Picker mode: click row to select
    if (idmapMode === "picker") {
      $idmapTableBody.querySelectorAll(".idmap-picker-row").forEach(row => {
        row.addEventListener("click", function() {
          const pickId = this.dataset.pickId;
          const pickName = this.dataset.pickName;
          const target = idmapPickerTarget;
          if (target === $wlSearchInput) {
            // Watchlist picker
            $wlSearchInput.value = pickName;
            wlSelectedItem = { id: pickId, name: pickName };
            $btnWlAdd.disabled = false;
          } else if (target === $pfSearchInput) {
            // Portfolio picker
            $pfSearchInput.value = pickName;
            $pfSearchInput.dataset.id = pickId;
          } else {
            // Main search
            selectedItemId = pickId;
            selectedItemName = pickName;
            $searchInput.value = pickName;
            $btnAnalyze.disabled = false;
          }
          closeIdmapModal();
        });
      });
    }
  } catch (e) {
    $idmapModalInfo.textContent = "加载失败";
    $idmapTableBody.innerHTML = "";
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function goToPage(page) {
  const totalPages = Math.ceil(idmapPreviewTotal / IDMAP_PAGE_SIZE) || 1;
  if (page < 1 || page > totalPages) return;
  idmapCurPage = page;
  idmapPreviewOffset = (page - 1) * IDMAP_PAGE_SIZE;
  loadIdmapPreview();
}

function renderPageButtons(cur, total) {
  const btns = [];
  const addNum = (n) => btns.push(`<button class="idmap-page-num${n === cur ? ' active' : ''}" data-page="${n}">${n}</button>`);
  const addEllipsis = () => btns.push(`<span class="idmap-page-ellipsis">&hellip;</span>`);

  if (total <= 9) {
    for (let i = 1; i <= total; i++) addNum(i);
  } else {
    addNum(1);
    if (cur > 4) addEllipsis();
    for (let i = Math.max(2, cur - 2); i <= Math.min(total - 1, cur + 2); i++) addNum(i);
    if (cur < total - 3) addEllipsis();
    addNum(total);
  }

  $idmapPageBtns.innerHTML = btns.join("");

  // Delegate click on page number buttons
  $idmapPageBtns.querySelectorAll(".idmap-page-num").forEach(btn => {
    btn.addEventListener("click", function() {
      const p = parseInt(this.dataset.page, 10);
      if (p !== cur) goToPage(p);
    });
  });
}

$idmapPrevBtn.addEventListener("click", () => goToPage(idmapCurPage - 1));
$idmapNextBtn.addEventListener("click", () => goToPage(idmapCurPage + 1));

// ── Page jump ──
const $idmapJumpInput = document.getElementById("idmap-jump-input");

$idmapJumpInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    const page = parseInt(this.value, 10);
    goToPage(page);
    this.value = "";
  }
});

// ═══════════════════════════════════════════════════════════
//  KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════

const $btnKbPage   = document.getElementById("btn-kb-page");
const $kbPage      = document.getElementById("kb-page");
const $kbList      = document.getElementById("kb-list");
const $kbSearch    = document.getElementById("kb-search");
const $btnKbAdd    = document.getElementById("btn-kb-add");
const $kbModal     = document.getElementById("kb-modal");
const $kbModalTitle = document.getElementById("kb-modal-title");
const $kbEditTitle = document.getElementById("kb-edit-title");
const $kbEditContent = document.getElementById("kb-edit-content");
const $kbEditTags  = document.getElementById("kb-edit-tags");
const $kbEditDate  = document.getElementById("kb-edit-date");
const $kbEditMsg   = document.getElementById("kb-edit-msg");
const $btnKbSave   = document.getElementById("btn-kb-save");
const $kbModalClose = document.getElementById("kb-modal-close");
const $kbModalOverlay = $kbModal.querySelector(".pf-modal-overlay");

let kbEditingId = null;
let kbCurPage = 1;
let kbTotalItems = 0;
const KB_PAGE_SIZE = 9;

// ── Pagination DOM refs ──
const $kbPagination = document.getElementById("kb-pagination");
const $kbTotal      = document.getElementById("kb-total");
const $kbPrevBtn    = document.getElementById("kb-prev-btn");
const $kbNextBtn    = document.getElementById("kb-next-btn");
const $kbPageBtns   = document.getElementById("kb-page-btns");
const $kbJumpInput  = document.getElementById("kb-jump-input");

function showPage(page) {
  hide($dashboard); hide($watchlistPage); hide($portfolioPage); hide($kbPage); hide($promptsPage);
  hide($resultsContainer); hide($loadingScreen);
  document.querySelectorAll(".btn-dash").forEach(b => b.classList.remove("active"));
  if (page === "kb") { show($kbPage); $btnKbPage.classList.add("active"); kbCurPage = 1; loadKbList(); }
}

$btnKbPage.addEventListener("click", () => showPage("kb"));

// ── Load KB list with pagination ──
async function loadKbList(q, page) {
  try {
    if (page !== undefined) kbCurPage = page;
    const searchQ = q !== undefined ? q : $kbSearch.value.trim();
    const offset = (kbCurPage - 1) * KB_PAGE_SIZE;
    let url = `/api/knowledge?limit=${KB_PAGE_SIZE}&offset=${offset}`;
    if (searchQ) url += "&q=" + encodeURIComponent(searchQ);

    const r = await fetch(url);
    const data = await r.json();
    const items = data.items || [];
    kbTotalItems = data.total || 0;

    if (!items.length && kbTotalItems === 0) {
      $kbList.innerHTML = '<div class="kb-empty">暂无条目，点击上方按钮添加</div>';
      $kbTotal.textContent = "共 0 条";
      $kbPageBtns.innerHTML = "";
      $kbPrevBtn.disabled = true;
      $kbNextBtn.disabled = true;
      return;
    }

    $kbList.innerHTML = items.map(e => `
      <div class="kb-card" data-kb-id="${e.id}">
        <div class="kb-card-header">
          <span class="kb-card-title">${escHtml(e.title)}</span>
          <div class="kb-card-actions">
            <button data-kb-edit="${e.id}">编辑</button>
            <button class="kb-btn-del" data-kb-del="${e.id}">删除</button>
          </div>
        </div>
        <div class="kb-card-content">${escHtml(e.content)}</div>
        <div class="kb-card-foot">
          <div class="kb-card-tags">${(e.tags||[]).map(t => `<span class="kb-tag">${escHtml(t)}</span>`).join("")}</div>
          <span class="kb-card-time">${e.event_date || new Date((e.updated_at||e.created_at)*1000).toLocaleDateString("zh-CN")}</span>
        </div>
      </div>
    `).join("");

    // Always show pagination with total count
    $kbTotal.textContent = `共 ${kbTotalItems} 条`;
    const totalPages = Math.ceil(kbTotalItems / KB_PAGE_SIZE) || 1;
    renderKbPageBtns(kbCurPage, totalPages);
    $kbPrevBtn.disabled = kbCurPage <= 1;
    $kbNextBtn.disabled = kbCurPage >= totalPages;

    // Click card → popup view modal
    $kbList.querySelectorAll("[data-kb-id]").forEach(card => {
      card.addEventListener("click", () => {
        const entry = items.find(e => e.id === card.dataset.kbId);
        if (entry) openKbView(entry);
      });
    });
    // Edit button
    $kbList.querySelectorAll("[data-kb-edit]").forEach(btn => {
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); openKbModal(items.find(e => e.id === btn.dataset.kbEdit)); });
    });
    // Delete button
    $kbList.querySelectorAll("[data-kb-del]").forEach(btn => {
      btn.addEventListener("click", async (ev) => { ev.stopPropagation();
        const entry = items.find(e => e.id === btn.dataset.kbDel);
        if (!entry) return;
        const ok = await showConfirmDialog(`删除事件「${entry.title}」？`);
        if (!ok) return;
        await fetch(`/api/knowledge/${entry.id}`, { method: "DELETE" });
        // If last item on last page, go back one page
        if (items.length === 1 && kbCurPage > 1) kbCurPage--;
        loadKbList();
        showToast("✓ 已删除");
      });
    });
  } catch (e) { /* ignore */ }
}

function renderKbPageBtns(cur, total) {
  const btns = [];
  const addNum = (n) => btns.push(`<button class="idmap-page-num${n === cur ? ' active' : ''}" data-page="${n}">${n}</button>`);
  const addEllipsis = () => btns.push(`<span class="idmap-page-ellipsis">&hellip;</span>`);

  if (total <= 9) {
    for (let i = 1; i <= total; i++) addNum(i);
  } else {
    addNum(1);
    if (cur > 4) addEllipsis();
    for (let i = Math.max(2, cur - 2); i <= Math.min(total - 1, cur + 2); i++) addNum(i);
    if (cur < total - 3) addEllipsis();
    addNum(total);
  }

  $kbPageBtns.innerHTML = btns.join("");
  $kbPageBtns.querySelectorAll(".idmap-page-num").forEach(btn => {
    btn.addEventListener("click", function() {
      const p = parseInt(this.dataset.page, 10);
      if (p !== kbCurPage) { kbCurPage = p; loadKbList(); }
    });
  });
}

function goKbPage(page) {
  const totalPages = Math.ceil(kbTotalItems / KB_PAGE_SIZE) || 1;
  if (page < 1 || page > totalPages) return;
  kbCurPage = page;
  loadKbList();
}

$kbPrevBtn.addEventListener("click", () => goKbPage(kbCurPage - 1));
$kbNextBtn.addEventListener("click", () => goKbPage(kbCurPage + 1));
$kbJumpInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    const page = parseInt(this.value, 10);
    goKbPage(page);
    this.value = "";
  }
});

$kbSearch.addEventListener("input", function() {
  kbCurPage = 1;
  loadKbList();
});

// ── Modal ──
function openKbModal(entry) {
  if (entry) {
    kbEditingId = entry.id;
    $kbModalTitle.textContent = "编辑事件";
    $kbEditTitle.value = entry.title;
    $kbEditDate.value = entry.event_date || "";
    $kbEditContent.value = entry.content;
    $kbEditTags.value = (entry.tags || []).join(", ");
  } else {
    kbEditingId = null;
    $kbModalTitle.textContent = "新增事件";
    $kbEditTitle.value = "";
    $kbEditDate.value = "";
    $kbEditContent.value = "";
    $kbEditTags.value = "";
  }
  $kbEditMsg.textContent = "";
  $kbEditMsg.className = "settings-msg";
  $kbModal.classList.remove("hidden");
}

function closeKbModal() {
  $kbModal.classList.add("hidden");
}

// ── View modal ──
const $kbViewModal   = document.getElementById("kb-view-modal");
const $kbViewClose   = document.getElementById("kb-view-close");
const $kbViewOverlay = $kbViewModal.querySelector(".pf-modal-overlay");
const $kbViewTitle   = document.getElementById("kb-view-title");
const $kbViewTags    = document.getElementById("kb-view-tags");
const $kbViewContent = document.getElementById("kb-view-content");
const $kbViewTime    = document.getElementById("kb-view-time");

function openKbView(entry) {
  $kbViewTitle.textContent = entry.title;
  $kbViewTags.innerHTML = (entry.tags || []).map(t => `<span class="kb-tag">${escHtml(t)}</span>`).join("");
  $kbViewContent.textContent = entry.content;
  $kbViewTime.textContent = (entry.event_date ? "事件日期 " + entry.event_date : "更新于 " + new Date((entry.updated_at || entry.created_at) * 1000).toLocaleString("zh-CN"));
  $kbViewModal.classList.remove("hidden");
}

function closeKbView() { $kbViewModal.classList.add("hidden"); }
$kbViewClose.addEventListener("click", closeKbView);
$kbViewOverlay.addEventListener("click", closeKbView);

$btnKbAdd.addEventListener("click", () => openKbModal(null));
$kbModalClose.addEventListener("click", closeKbModal);

$btnKbSave.addEventListener("click", async () => {
  const title = $kbEditTitle.value.trim();
  const content = $kbEditContent.value.trim();
  if (!title || !content) {
    $kbEditMsg.textContent = "标题和内容不能为空";
    $kbEditMsg.className = "settings-msg error";
    return;
  }
  const tags = $kbEditTags.value.split(",").map(t => t.trim()).filter(Boolean);
  const eventDate = $kbEditDate.value.trim();
  const method = kbEditingId ? "PUT" : "POST";
  const url = kbEditingId ? `/api/knowledge/${kbEditingId}` : "/api/knowledge";

  try {
    $btnKbSave.disabled = true;
    $btnKbSave.textContent = "保存中…";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, tags, event_date: eventDate || null }),
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    // 弹窗内显示成功提示
    $kbEditMsg.textContent = "✓ 保存成功";
    $kbEditMsg.className = "settings-msg";
    await new Promise(r => setTimeout(r, 600));
    closeKbModal();
    if (!kbEditingId) kbCurPage = 1;
    loadKbList();
    showToast(kbEditingId ? "✓ 已更新" : "✓ 已添加");
  } catch (e) {
    $kbEditMsg.textContent = "✕ " + (e.message || "保存失败");
    $kbEditMsg.className = "settings-msg error";
  } finally {
    $btnKbSave.disabled = false;
    $btnKbSave.textContent = "保存";
  }
});

// ── Apply saved theme on startup ──
(async function applyStartupTheme() {
  try {
    const r = await fetch("/api/settings");
    const d = await r.json();
    applyTheme(d);
  } catch (e) { /* ignore */ }
})();

// ═══════════════════════════════════════════════════════════
//  PROMPT MANAGEMENT (提示词管理)
// ═══════════════════════════════════════════════════════════

const $promptsContainer = document.getElementById("prompts-container");
let promptsData = {};

async function loadPrompts() {
  try {
    const r = await fetch("/api/prompts");
    promptsData = await r.json();
    renderPrompts();
  } catch (e) { /* ignore */ }
}

const CARD_ICONS = {
  analysis_system: { cls: "system", char: "&#9830;" },
  analysis_instruction: { cls: "instruction", char: "&#9776;" },
  chat_system: { cls: "chat", char: "&#9993;" },
  portfolio_advice: { cls: "portfolio", char: "&#9824;" },
};

function renderPrompts() {
  const keys = Object.keys(promptsData);
  $promptsContainer.innerHTML = keys.map(key => {
    const p = promptsData[key];
    const items = p.items || [];
    const active = items.find(it => it.id === p.active_id);
    const activeText = active ? active.text : "";
    const activeName = active ? active.name : "";
    const icon = CARD_ICONS[key] || { cls: "system", char: "&#9632;" };
    return `
      <div class="prompt-card" data-key="${key}">
        <div class="prompt-card-header">
          <div class="prompt-card-icon ${icon.cls}">${icon.char}</div>
          <div class="prompt-card-info">
            <div class="prompt-card-label">${p.label}</div>
            <div class="prompt-card-desc">${p.desc}</div>
          </div>
        </div>
        <div class="prompt-card-body">
          <div class="prompt-card-select-row">
            <span>当前:</span>
            <select class="prompt-card-select" data-key="${key}">
              ${items.map(it => `<option value="${it.id}"${it.id === p.active_id ? ' selected' : ''}>${escHtml(it.name)}${it.builtin ? ' (内置)' : ''}</option>`).join("")}
            </select>
          </div>
          <textarea class="prompt-card-preview" readonly rows="3">${escHtml(activeText).substring(0, 200)}${activeText.length > 200 ? '…' : ''}</textarea>
        </div>
        <div class="prompt-card-foot">
          <button class="prompt-card-mgr-btn" data-key="${key}">管理模板 →</button>
        </div>
      </div>`;
  }).join("");

  // Select change → switch active template
  $promptsContainer.querySelectorAll(".prompt-card-select").forEach(sel => {
    sel.addEventListener("change", async function() {
      const key = this.dataset.key;
      const tid = this.value;
      try {
        const r = await fetch(`/api/prompts/${key}/active`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: tid }),
        });
        if (r.ok) {
          promptsData[key].active_id = tid;
          showToast("✓ 已切换");
          renderPrompts();
        }
      } catch (e) { /* ignore */ }
    });
  });

  // "管理模板" button
  $promptsContainer.querySelectorAll(".prompt-card-mgr-btn").forEach(btn => {
    btn.addEventListener("click", () => openPromptMgrModal(btn.dataset.key));
  });
}

// ═══════════════════════════════════════════
//  Template Manager Modal
// ═══════════════════════════════════════════

const $promptMgrModal  = document.getElementById("prompt-mgr-modal");
const $promptMgrTitle  = document.getElementById("prompt-mgr-title");
const $promptMgrList   = document.getElementById("prompt-mgr-list");
const $promptMgrName   = document.getElementById("prompt-mgr-name");
const $promptMgrText   = document.getElementById("prompt-mgr-text");
const $promptMgrVars   = document.getElementById("prompt-mgr-vars");
const $promptMgrMsg    = document.getElementById("prompt-mgr-msg");
const $promptMgrSave   = document.getElementById("prompt-mgr-save");
const $promptMgrSetAct = document.getElementById("prompt-mgr-set-active");
const $promptMgrDelete = document.getElementById("prompt-mgr-delete");
const $promptMgrNew    = document.getElementById("prompt-mgr-new");

let mgrKey = null;     // current prompt key being managed
let mgrCurId = null;   // currently selected template id in the editor

function openPromptMgrModal(key) {
  mgrKey = key;
  mgrCurId = null;
  const p = promptsData[key];
  $promptMgrTitle.textContent = "管理模板: " + (p.label || key);
  $promptMgrMsg.textContent = "";
  $promptMgrMsg.className = "settings-msg";

  // Show vars hint
  if (p.vars && p.vars.length) {
    $promptMgrVars.style.display = "block";
    $promptMgrVars.textContent = "可用变量：" + p.vars.join(", ");
  } else {
    $promptMgrVars.style.display = "none";
  }

  renderMgrList();
  $promptMgrModal.classList.remove("hidden");
}

function closePromptMgrModal() {
  $promptMgrModal.classList.add("hidden");
  mgrKey = null; mgrCurId = null;
}

document.getElementById("prompt-mgr-close").addEventListener("click", closePromptMgrModal);
$promptMgrModal.querySelector(".pf-modal-overlay").addEventListener("click", closePromptMgrModal);

function renderMgrList() {
  const p = promptsData[mgrKey];
  const items = p.items || [];
  if (!mgrCurId && items.length) mgrCurId = items[0].id;

  $promptMgrList.innerHTML = items.map(it => `
    <div class="prompt-mgr-item${it.id === mgrCurId ? ' active' : ''}" data-tid="${it.id}">
      <span class="prompt-mgr-item-dot"></span>
      ${escHtml(it.name)}${it.builtin ? ' <span style="font-size:0.55rem;color:var(--text-tertiary);">内置</span>' : ''}
    </div>
  `).join("");

  // Click to select
  $promptMgrList.querySelectorAll(".prompt-mgr-item").forEach(el => {
    el.addEventListener("click", () => selectMgrTemplate(el.dataset.tid));
  });

  // Load selected into editor
  if (mgrCurId) loadMgrEditor(mgrCurId);
}

function selectMgrTemplate(tid) {
  mgrCurId = tid;
  $promptMgrList.querySelectorAll(".prompt-mgr-item").forEach(el => {
    el.classList.toggle("active", el.dataset.tid === tid);
  });
  loadMgrEditor(tid);
}

function loadMgrEditor(tid) {
  const p = promptsData[mgrKey];
  const item = (p.items || []).find(it => it.id === tid);
  if (!item) return;
  $promptMgrName.value = item.name || "";
  $promptMgrText.value = item.text || "";
  // builtin 模板不可编辑
  const isBuiltin = !!item.builtin;
  $promptMgrName.readOnly = isBuiltin;
  $promptMgrText.readOnly = isBuiltin;
  $promptMgrSave.style.display = isBuiltin ? "none" : "";
  $promptMgrDelete.style.display = isBuiltin ? "none" : "";
  if (isBuiltin) {
    $promptMgrText.style.background = "var(--bg-inset)";
    $promptMgrText.style.cursor = "not-allowed";
    $promptMgrText.style.opacity = "0.7";
  } else {
    $promptMgrText.style.background = "";
    $promptMgrText.style.cursor = "";
    $promptMgrText.style.opacity = "";
  }
  $promptMgrMsg.textContent = "";
  $promptMgrMsg.className = "settings-msg";
}

// ── Save ──
$promptMgrSave.addEventListener("click", async () => {
  if (!mgrKey || !mgrCurId) return;
  const name = $promptMgrName.value.trim();
  const text = $promptMgrText.value;
  if (!name || !text) {
    $promptMgrMsg.textContent = "名称和内容不能为空";
    $promptMgrMsg.className = "settings-msg error";
    return;
  }
  try {
    const r = await fetch(`/api/prompts/${mgrKey}/templates/${mgrCurId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, text }),
    });
    if (r.ok) {
      const item = (promptsData[mgrKey].items || []).find(it => it.id === mgrCurId);
      if (item) { item.name = name; item.text = text; }
      $promptMgrMsg.textContent = "✓ 已保存";
      $promptMgrMsg.className = "settings-msg";
      showToast("✓ 已保存");
      renderMgrList();
      renderPrompts();
    } else {
      const d = await r.json();
      $promptMgrMsg.textContent = "✕ " + (d.error || "保存失败");
      $promptMgrMsg.className = "settings-msg error";
    }
  } catch (e) {
    $promptMgrMsg.textContent = "✕ 网络请求失败";
    $promptMgrMsg.className = "settings-msg error";
  }
});

// ── Set Active ──
$promptMgrSetAct.addEventListener("click", async () => {
  if (!mgrKey || !mgrCurId) return;
  try {
    const r = await fetch(`/api/prompts/${mgrKey}/active`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mgrCurId }),
    });
    if (r.ok) {
      promptsData[mgrKey].active_id = mgrCurId;
      $promptMgrMsg.textContent = "✓ 已设为当前";
      $promptMgrMsg.className = "settings-msg";
      renderMgrList();
      renderPrompts();
      showToast("✓ 已切换模板");
    } else {
      const d = await r.json();
      $promptMgrMsg.textContent = "✕ " + (d.error || "操作失败");
      $promptMgrMsg.className = "settings-msg error";
    }
  } catch (e) {
    $promptMgrMsg.textContent = "✕ 网络请求失败";
    $promptMgrMsg.className = "settings-msg error";
  }
});

// ── Delete ──
$promptMgrDelete.addEventListener("click", async () => {
  if (!mgrKey || !mgrCurId) return;
  const item = (promptsData[mgrKey].items || []).find(it => it.id === mgrCurId);
  if (!item || item.builtin) return;
  const ok = await showConfirmDialog(`删除模板「${item.name}」？<br><span style="font-size:0.7rem;color:var(--text-tertiary);">此操作不可撤销</span>`);
  if (!ok) return;
  try {
    const r = await fetch(`/api/prompts/${mgrKey}/templates/${mgrCurId}`, { method: "DELETE" });
    if (r.ok) {
      promptsData[mgrKey].items = (promptsData[mgrKey].items || []).filter(it => it.id !== mgrCurId);
      mgrCurId = (promptsData[mgrKey].items || [])[0]?.id || null;
      $promptMgrMsg.textContent = "";
      $promptMgrMsg.className = "settings-msg";
      renderMgrList();
      renderPrompts();
      showToast("✓ 已删除");
    } else {
      const d = await r.json();
      $promptMgrMsg.textContent = "✕ " + (d.error || "删除失败");
      $promptMgrMsg.className = "settings-msg error";
    }
  } catch (e) {
    $promptMgrMsg.textContent = "✕ 网络请求失败";
    $promptMgrMsg.className = "settings-msg error";
  }
});

// ── New Template ──
$promptMgrNew.addEventListener("click", async () => {
  if (!mgrKey) return;
  try {
    const r = await fetch(`/api/prompts/${mgrKey}/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "新模板", text: "在此输入提示词内容…" }),
    });
    if (r.ok) {
      const d = await r.json();
      promptsData[mgrKey].items.push({ id: d.id, name: d.name, text: "在此输入提示词内容…", builtin: false });
      mgrCurId = d.id;
      $promptMgrMsg.textContent = "";
      $promptMgrMsg.className = "settings-msg";
      renderMgrList();
      renderPrompts();
      showToast("✓ 新模板已创建");
    } else {
      const d = await r.json();
      $promptMgrMsg.textContent = "✕ " + (d.error || "创建失败");
      $promptMgrMsg.className = "settings-msg error";
    }
  } catch (e) {
    $promptMgrMsg.textContent = "✕ 网络请求失败";
    $promptMgrMsg.className = "settings-msg error";
  }
});

// ESC to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$promptMgrModal.classList.contains("hidden")) {
    // Only close if not focused on an input inside the modal
    const active = document.activeElement;
    if (!active || !active.closest("#prompt-mgr-modal")) {
      closePromptMgrModal();
    }
  }
});

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

// ═══════════════════════════════════════════════════════════
//  PORTFOLIO (持仓)
// ═══════════════════════════════════════════════════════════

const $portfolioPage    = document.getElementById("portfolio-page");
const $promptsPage     = document.getElementById("prompts-page");
const $pfSearchInput    = document.getElementById("pf-search-input");
const $pfSearchResults  = document.getElementById("pf-search-results");
const $pfBuyPrice       = document.getElementById("pf-buy-price");
const $pfQuantity       = document.getElementById("pf-quantity");
const $pfTableBody      = document.getElementById("pf-table-body");
const $pfAdviceModal    = document.getElementById("pf-advice-modal");
const $pfAdviceTitle    = document.getElementById("pf-advice-title");
const $pfAdviceText     = document.getElementById("pf-advice-text");
let pfSearchTimeout = null;

async function loadPortfolio() {
  try {
    const r = await fetch("/api/portfolio");
    const items = await r.json();
    renderPortfolio(items);
  } catch(e) { /* ignore */ }
}

function renderPortfolio(items) {
  // Summary
  let totalCost = 0, totalValue = 0, totalQty = 0;
  items.forEach(p => {
    const cost = (p.buy_price||0) * (p.quantity||1);
    const value = (p.current_price||0) * (p.quantity||1);
    totalCost += cost;
    totalValue += value;
    totalQty += (p.quantity||1);
  });
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;

  document.getElementById("pf-value").textContent = "¥" + totalValue.toLocaleString("zh-CN", {minimumFractionDigits:2});
  document.getElementById("pf-cost").textContent = "¥" + totalCost.toLocaleString("zh-CN", {minimumFractionDigits:2});
  const pnlEl = document.getElementById("pf-pnl");
  pnlEl.textContent = (totalPnl >= 0 ? "+" : "") + "¥" + totalPnl.toLocaleString("zh-CN", {minimumFractionDigits:2});
  pnlEl.style.color = totalPnl >= 0 ? "var(--cinnabar)" : "var(--malachite)";
  const pnlPctEl = document.getElementById("pf-pnl-pct");
  pnlPctEl.textContent = (totalPnlPct >= 0 ? "+" : "") + totalPnlPct.toFixed(2) + "%";
  pnlPctEl.className = "pf-card-sub " + (totalPnl >= 0 ? "positive" : "negative");
  document.getElementById("pf-count").textContent = totalQty + " 件";

  // Table
  if (!items.length) {
    $pfTableBody.innerHTML = '<tr class="wl-empty-row"><td colspan="9">暂无持仓，在上方搜索添加</td></tr>';
    return;
  }
  $pfTableBody.innerHTML = items.map(p => {
    const cost = (p.buy_price||0) * (p.quantity||1);
    const value = (p.current_price||0) * (p.quantity||1);
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost * 100) : 0;
    const pnlCls = pnl >= 0 ? "positive" : "negative";
    const s = (v) => v >= 0 ? "+" : "-";
    return `<tr>
      <td class="wl-td-item">
        <img src="${p.img||''}" loading="lazy" onerror="this.style.display='none'">
        <span class="wl-td-name" title="${(p.name||'').replace(/"/g,'&quot;')}">${p.name||'ID:'+p.id}</span>
      </td>
      <td class="wl-td-price">¥${Number(p.buy_price||0).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-price">¥${Number(p.current_price||0).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-num">${p.quantity||1}</td>
      <td class="wl-td-price">¥${cost.toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-price">¥${value.toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-chg ${pnlCls}">${s(pnl)}¥${Math.abs(pnl).toLocaleString('zh-CN',{minimumFractionDigits:2})}</td>
      <td class="wl-td-chg ${pnlCls}">${s(pnlPct)}${Math.abs(pnlPct).toFixed(1)}%</td>
      <td class="wl-td-del">
        <button data-pf-edit="${p.id}" data-pf-edit-name="${(p.name||'').replace(/"/g,'&quot;')}" data-pf-edit-price="${p.buy_price||0}" data-pf-edit-qty="${p.quantity||1}" title="编辑" style="margin-right:2px;">✎</button>
        <button data-pf-advice="${p.id}" title="AI建议" style="margin-right:2px;">?</button>
        <button data-pf-remove="${p.id}" title="移除">✕</button>
      </td>
    </tr>`;
  }).join("");
}

// ── Search to add ──
$pfSearchInput.addEventListener("click", () => openIdmapModal("picker", $pfSearchInput));
$pfSearchInput.addEventListener("input", function() {
  clearTimeout(pfSearchTimeout);
  const q = this.value.trim();
  if (q.length < 2) { $pfSearchResults.innerHTML = ""; return; }
  pfSearchTimeout = setTimeout(async () => {
    try {
      const r = await fetch("/api/search", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({keyword: q})});
      const d = await r.json();
      $pfSearchResults.innerHTML = (d.matches||[]).map(m =>
        `<div class="sr-item" data-id="${m.id}" data-name="${m.name.replace(/"/g,'&quot;')}">${m.name}</div>`
      ).join("");
    } catch(e) { $pfSearchResults.innerHTML = ""; }
  }, 300);
});

$pfSearchResults.addEventListener("click", function(e) {
  const item = e.target.closest(".sr-item");
  if (!item) return;
  $pfSearchInput.value = item.dataset.name;
  $pfSearchInput.dataset.id = item.dataset.id;
  $pfSearchResults.innerHTML = "";
});

// ── Add holding ──
document.getElementById("btn-pf-add").addEventListener("click", async () => {
  const itemId = $pfSearchInput.dataset.id;
  const buyPrice = parseFloat($pfBuyPrice.value);
  const quantity = parseInt($pfQuantity.value) || 1;
  if (!itemId || !buyPrice || buyPrice <= 0) { alert("请搜索饰品并填写买入价"); return; }
  try {
    const r = await fetch("/api/portfolio/add", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({item_id: itemId, item_name: $pfSearchInput.value, buy_price: buyPrice, quantity: quantity}),
    });
    if (r.ok) {
      $pfSearchInput.value = ""; $pfSearchInput.dataset.id = "";
      $pfBuyPrice.value = ""; $pfQuantity.value = "";
      await loadPortfolio();
    } else if (r.status === 409) { alert("已在持仓中"); }
  } catch(e) { /* ignore */ }
});

// ── Edit modal ──
let pfEditItemId = null;
const $pfEditModal   = document.getElementById("pf-edit-modal");
const $pfEditName    = document.getElementById("pf-edit-name");
const $pfEditPrice   = document.getElementById("pf-edit-price");
const $pfEditQty     = document.getElementById("pf-edit-qty");

function openPfEditModal(itemId, itemName, buyPrice, quantity) {
	pfEditItemId = itemId;
	$pfEditName.textContent = itemName;
	$pfEditPrice.value = buyPrice;
	$pfEditQty.value = quantity;
	$pfEditModal.classList.remove("hidden");
	$pfEditPrice.focus();
}

function closePfEditModal() {
	$pfEditModal.classList.add("hidden");
	pfEditItemId = null;
}

document.getElementById("btn-pf-edit-close").addEventListener("click", closePfEditModal);
document.getElementById("btn-pf-edit-cancel").addEventListener("click", closePfEditModal);
$pfEditModal.querySelector(".pf-modal-overlay").addEventListener("click", closePfEditModal);

document.getElementById("btn-pf-edit-save").addEventListener("click", async () => {
	if (!pfEditItemId) return;
	const newPrice = parseFloat($pfEditPrice.value);
	const newQty = parseInt($pfEditQty.value);
	if (isNaN(newPrice) || newPrice <= 0) { alert("请输入有效的买入价"); return; }
	if (isNaN(newQty) || newQty <= 0) { alert("请输入有效的数量"); return; }

	try {
		const r = await fetch("/api/portfolio/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ item_id: pfEditItemId, buy_price: newPrice, quantity: newQty }),
		});
		if (r.ok) {
			closePfEditModal();
			await loadPortfolio();
			showToast("✓ 已保存");
		} else {
			const d = await r.json();
			alert(d.error || "保存失败");
		}
	} catch (e) { alert("网络请求失败"); }
});

// Keyboard: Enter to save, Esc to close
$pfEditModal.addEventListener("keydown", (e) => {
	if (e.key === "Enter") { e.preventDefault(); document.getElementById("btn-pf-edit-save").click(); }
	if (e.key === "Escape") { closePfEditModal(); }
});

// ── Remove & Edit ──
$pfTableBody.addEventListener("click", async (e) => {
  const editBtn = e.target.closest("button[data-pf-edit]");
  if (editBtn) {
    openPfEditModal(
      editBtn.dataset.pfEdit,
      editBtn.dataset.pfEditName,
      parseFloat(editBtn.dataset.pfEditPrice),
      parseInt(editBtn.dataset.pfEditQty)
    );
    return;
  }
  const rmBtn = e.target.closest("button[data-pf-remove]");
  if (rmBtn) {
    const row = rmBtn.closest("tr");
    const name = row?.querySelector(".wl-td-name")?.textContent || "此持仓";
    const ok = await showConfirmDialog(`从持仓移除「${name}」？`);
    if (!ok) return;
    await fetch("/api/portfolio/remove", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({item_id: rmBtn.dataset.pfRemove})});
    await loadPortfolio();
    showToast("✓ 已移除");
  }
});

// ── AI Advice ──
$pfTableBody.addEventListener("click", async (e) => {
  const advBtn = e.target.closest("button[data-pf-advice]");
  if (!advBtn) return;
  const itemId = advBtn.dataset.pfAdvice;

  // Find holding name
  let itemName = "ID:" + itemId;
  try {
    const r = await fetch("/api/portfolio");
    const items = await r.json();
    const h = items.find(p => String(p.id) === itemId);
    if (h) itemName = h.name || itemName;
  } catch(e) {}

  // Confirm before AI analysis
  const modelName = document.getElementById("set-deepseek-model")?.value || "deepseek-v4-pro";
  const ok = await showConfirmDialog(`使用 AI 分析「${itemName}」的持仓建议？<br><span style="font-size:0.7rem;color:var(--text-tertiary);">当前模型：${modelName}</span>`);
  if (!ok) return;

  $pfAdviceTitle.textContent = "AI 建议 — " + itemName;
  $pfAdviceText.textContent = "正在分析...";
  $pfAdviceModal.classList.remove("hidden");

  try {
    const r = await fetch("/api/portfolio/advice", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({item_id: itemId}),
    });
    const d = await r.json();
    if (d.advice) {
      $pfAdviceText.innerHTML = simpleMD(d.advice);
    } else {
      $pfAdviceText.textContent = "错误: " + (d.error || "未知");
    }
  } catch(e) { $pfAdviceText.textContent = "请求失败"; }
});

document.getElementById("btn-pf-advice-close").addEventListener("click", () => {
  $pfAdviceModal.classList.add("hidden");
});
$pfAdviceModal.querySelector(".pf-modal-overlay").addEventListener("click", () => {
  $pfAdviceModal.classList.add("hidden");
});

// ── Refresh prices ──
document.getElementById("btn-pf-refresh").addEventListener("click", async () => {
  const btn = document.getElementById("btn-pf-refresh");
  if (btn.classList.contains("spin")) return;
  btn.classList.add("spin");
  setTimeout(() => btn.classList.remove("spin"), 600);
  try {
    await fetch("/api/portfolio/refresh", {method:"POST"});
    await loadPortfolio();
  } catch(e) {}
});

// ── Page nav ──
document.getElementById("btn-portfolio-page").addEventListener("click", () => {
  hide($dashboard);
  hide($watchlistPage);
  hide($kbPage);
  hide($promptsPage);

  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($portfolioPage);
  setActiveNav("btn-portfolio-page");
  loadHistory(); // 刷新侧边栏去掉高亮
  loadPortfolio().then(() => {
    // 后台自动刷新最新价格
    fetch("/api/portfolio/refresh", {method:"POST"}).then(() => loadPortfolio()).catch(() => {});
  });
});

// ═══════════════════════════════════════════════════════════
//  REFRESH — manual + auto (5 min)
// ═══════════════════════════════════════════════════════════

const $btnRefresh = document.getElementById("btn-refresh");

$btnRefresh.addEventListener("click", async () => {
  if ($btnRefresh.classList.contains("spin")) return;
  $btnRefresh.classList.add("spin");
  setTimeout(() => $btnRefresh.classList.remove("spin"), 600);

  await loadDashboard();
  setStatus(true, "已刷新");
});

// Auto-refresh every 5 minutes (only when dashboard is visible)
setInterval(() => {
  if (!$dashboard.classList.contains("hidden")) {
    loadDashboard();
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
//  IMAGE VIEWER — 点击走势图弹窗查看大图
// ═══════════════════════════════════════════════════════════

const $imgViewer    = document.getElementById("img-viewer");
const $imgViewerImg = document.getElementById("img-viewer-img");
const $imgViewerBg  = $imgViewer.querySelector(".img-viewer-bg");
const $imgViewerClose = document.getElementById("img-viewer-close");

function openImageViewer(src) {
  if (!src) return;
  $imgViewerImg.src = src;
  $imgViewer.classList.remove("hidden");
}
function closeImageViewer() {
  $imgViewer.classList.add("hidden");
}

$chartImg.addEventListener("click", () => openImageViewer($chartImg.src));
$imgViewerBg.addEventListener("click", closeImageViewer);
$imgViewerClose.addEventListener("click", closeImageViewer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$imgViewer.classList.contains("hidden")) {
    closeImageViewer();
  }
});

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════

(async function init() {
  setStatus(false, "连接中...");
  await loadHistory();
  loadWatchlist();  // 加载自选列表
  loadDashboard();  // 加载大盘数据（默认首页）
  setStatus(true, "就绪");
})();
