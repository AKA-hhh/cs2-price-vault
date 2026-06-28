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
    document.getElementById("set-steam-cookie").value = d.steam_cookie_masked || "";
    // Chart engine
    setToggle("set-chart-engine", d.chart_engine || "matplotlib");
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
  const chartEngine = document.querySelector("#set-chart-engine .toggle-btn.active")?.dataset?.value || "matplotlib";
  const aiTemp = document.getElementById("set-ai-temperature").value;
  const chatTemp = document.getElementById("set-chat-temperature").value;
  const steamCookie = document.getElementById("set-steam-cookie").value.trim();

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
        steam_cookie: steamCookie,
        theme, accent, font_size: "large", chart_engine: chartEngine,
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
