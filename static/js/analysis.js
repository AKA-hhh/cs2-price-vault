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
  hide($kbPage);
  hide($promptsPage);
  hide($inventoryPage);

  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($watchlistPage);
  setActiveNav("btn-watchlist-page");
  activeAnalysisId = null;
  loadHistory(true); // keepActiveId 防止服务器 active_id 覆盖
  loadWatchlist().then(() => {
    // 后台自动刷新最新价格
    fetch("/api/watchlist/refresh", {method:"POST"}).then(r => r.json()).then(items => {
      renderWatchlistTable(items);
    }).catch(() => {});
  });
}

function showPromptsPage() {
  hide($dashboard);
  hide($watchlistPage);
  hide($kbPage);
  hide($inventoryPage);

  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  show($promptsPage);
  setActiveNav("btn-prompts-page");
  activeAnalysisId = null;
  loadHistory(true);
  loadPrompts();
}

$btnAnalyze.addEventListener("click", runAnalysis);

async function runAnalysis() {
  if (!selectedItemId || isAnalyzing) return;
  isAnalyzing = true;

  hide($dashboard);
  hide($watchlistPage);
  hide($kbPage);
  hide($promptsPage);
  hide($inventoryPage);
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
  hide($kbPage);
  hide($promptsPage);
  hide($inventoryPage);

  hide($loadingScreen);
  hide($errorToast);
  show($resultsContainer);
  setActiveNav(null);  // 分析结果页不属于任何导航页

  // ── Chart ──
  // 释放旧的 iframe Blob URL
  if (_chartBlobUrl) { URL.revokeObjectURL(_chartBlobUrl); _chartBlobUrl = null; }

  if (data.chart_html) {
    // Plotly 交互式图表：用 iframe + Blob URL 渲染
    hide($chartImg);
    // 先隐藏再设 src，强制浏览器在内容加载后重新计算布局
    hide($chartIframe);
    $chartIframe.src = "about:blank";
    const blob = new Blob([data.chart_html], { type: "text/html" });
    _chartBlobUrl = URL.createObjectURL(blob);
    $chartIframe.onload = () => { show($chartIframe); };
    $chartIframe.src = _chartBlobUrl;
  } else {
    // Matplotlib 静态图表
    hide($chartIframe);
    $chartImg.src = "data:image/png;base64," + data.chart_b64;
    show($chartImg);
  }
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
  hide($kbPage);
  hide($promptsPage);
  hide($inventoryPage);

  $errorToast.textContent = "✕ " + msg;
  show($errorToast);
  setTimeout(() => hide($errorToast), 8000);
}

function resetToWelcome() {
  hide($resultsContainer);
  hide($loadingScreen);
  hide($errorToast);
  hide($watchlistPage);
  hide($kbPage);
  hide($promptsPage);
  hide($inventoryPage);

  show($dashboard);
  setActiveNav("btn-dashboard");
  activeAnalysisId = null;
  loadHistory(true); // keepActiveId 防止服务器 active_id 覆盖
  $searchInput.value = "";
  selectedItemId = null; selectedItemName = null;
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
