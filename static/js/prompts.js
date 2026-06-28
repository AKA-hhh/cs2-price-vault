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
