// ═══════════════════════════════════════════════════════════
//  KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════

const $btnKbPage   = document.getElementById("btn-kb-page");
// $kbPage — 已提升至 core.js
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
  hide($dashboard); hide($watchlistPage); hide($kbPage); hide($promptsPage); hide($inventoryPage); hide($rankPage);
  hide($resultsContainer); hide($loadingScreen);
  document.querySelectorAll(".btn-dash").forEach(b => b.classList.remove("active"));
  activeAnalysisId = null;
  loadHistory(true);
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
