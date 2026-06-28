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
    const pendingDaysRaw = pendingEl ? pendingEl.querySelector(".hi-period")?.textContent || "" : "";
    // 提取纯数字（避免文本"90D"传入 prependPendingHistory 后再次拼接 "D" 导致 "90DD"）
    const pendingDays = parseInt(pendingDaysRaw) || "";
    renderHistory(data.analyses || []);
    $historyCount.textContent = (data.analyses || []).length;
    // 恢复 pending 项
    if (pendingName) {
      prependPendingHistory(pendingName, pendingDays);
    }
  } catch (e) { console.error("loadHistory 失败:", e); }
}

function renderHistory(analyses) {
  const scrollTop = $historyList.scrollTop; // 记住滚动位置
  if (!analyses.length) {
    $historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }
  $historyList.innerHTML = analyses.map(a => {
    const scoreCls = a.score >= 30 ? "positive" : a.score > -30 ? "neutral" : "negative";
    const isActive = a.id === activeAnalysisId;
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
    // 先从 DOM 移除，防止 loadHistory 失败导致已删除项仍然可见
    hi?.remove();
    const count = $historyList.querySelectorAll(".history-item").length;
    $historyCount.textContent = count;
    if (!count) {
      $historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    }
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
