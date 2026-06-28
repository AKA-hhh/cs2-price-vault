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
