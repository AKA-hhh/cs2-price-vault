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
const $chartIframe   = document.getElementById("chart-iframe");
const $chartLabel    = document.getElementById("chart-label");
let _chartBlobUrl = null;  // 用于释放旧的 iframe Blob URL
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
// 跨模块共享的页面容器（analysis/kb 等模块需要引用）
const $kbPage         = document.getElementById("kb-page");
const $promptsPage    = document.getElementById("prompts-page");
const $inventoryPage  = document.getElementById("inventory-page");
const $rankPage       = document.getElementById("rank-page");

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
const escapeHTML = (s) => { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; };
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
