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
  await loadHistory(true);  // 初始为仪表盘，不设置 activeAnalysisId
  loadWatchlist();  // 加载自选列表
  loadDashboard();  // 加载大盘数据（默认首页）
  setStatus(true, "就绪");
})();
