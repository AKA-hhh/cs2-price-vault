# -*- coding: utf-8 -*-
"""AI 追问 API (同步 + SSE 流式)"""

import re
import json
from flask import Blueprint, request, jsonify, Response
import shared
from core.ai_analysis import chat_with_context

chat_bp = Blueprint("chat", __name__)

# ── 输入校验 ──
MAX_QUESTION_LENGTH = 2000

# 明显的注入特征（用户消息中出现这些模式时拦截）
_INJECTION_PATTERNS = [
    re.compile(r"忽略\s*(之前|所有|上面|以上|前面)\s*(的\s*)?(指令|指示|提示|系统|规则|设定|要求)", re.I),
    re.compile(r"(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|directives?|prompts?)", re.I),
    re.compile(r"(你现在|现在你|你現在|请?扮演|假装|你是一个?)\s*(是\s*)?(一个?|新的?\s*)?(角色|身份|AI|助手|机器人)", re.I),
    re.compile(r"(system\s*prompt|系统提示|sys\s*msg|system\s*message)\s*(is|:|：)", re.I),
    re.compile(r"(你的\s*)?(system|系统)\s*(prompt|提示词|提示)\s*(是|为|：)", re.I),
    re.compile(r"(output|输出)\s*(your|the)\s*(system|base)\s*(prompt|instructions?)", re.I),
]


def _validate_and_wrap(question):
    """校验用户输入，通过则返回定界后的内容，否则返回 (None, error_msg)。"""
    if not question:
        return None, "问题不能为空"

    if len(question) > MAX_QUESTION_LENGTH:
        return None, f"问题过长（{len(question)}字符），请限制在{MAX_QUESTION_LENGTH}字以内"

    # 检测注入特征
    for pat in _INJECTION_PATTERNS:
        if pat.search(question):
            return None, "输入包含不支持的指令模式，请重新表述您的问题。"

    # 定界用户输入，给 AI 明确的数据/指令边界
    wrapped = f"<user_input>\n{question}\n</user_input>"
    return wrapped, None


@chat_bp.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(force=True)
    question = (data.get("question") or "").strip()
    analysis_id = (data.get("analysis_id") or "").strip()

    wrapped, err = _validate_and_wrap(question)
    if err:
        return jsonify({"error": err}), 400

    user_data = shared._get_user_data()
    if not analysis_id:
        analysis_id = user_data.get("active_id")

    analysis = user_data["analyses"].get(analysis_id) if analysis_id else None
    if not analysis or not analysis.get("messages"):
        return jsonify({"error": "分析会话不存在或已过期"}), 400

    print(f"[追问] {analysis['item_name']}: {question[:50]}...")

    ok, reply = chat_with_context(analysis["messages"], wrapped)

    if ok is True:
        shared._save_analysis_to_disk(analysis)
        msgs = analysis.get("messages") or []
        chat_msgs = msgs[3:] if len(msgs) > 3 else []
        return jsonify({"reply": reply, "analysis_id": analysis_id, "chat_messages": chat_msgs})
    elif ok is False:
        return jsonify({"reply": reply, "analysis_id": analysis_id})
    else:
        return jsonify({"error": reply}), 500


@chat_bp.route("/api/chat/stream", methods=["POST"])
def api_chat_stream():
    import requests as req_lib
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_CHAT_MODEL, CHAT_TEMPERATURE, AI_TIMEOUT

    data = request.get_json(force=True)
    question = (data.get("question") or "").strip()
    analysis_id = (data.get("analysis_id") or "").strip()

    wrapped, err = _validate_and_wrap(question)
    if err:
        return jsonify({"error": err}), 400

    user_data = shared._get_user_data()
    if not analysis_id:
        analysis_id = user_data.get("active_id")

    analysis = user_data["analyses"].get(analysis_id) if analysis_id else None
    if not analysis or not analysis.get("messages"):
        return jsonify({"error": "分析会话不存在或已过期"}), 400

    if not DEEPSEEK_API_KEY:
        return jsonify({"error": "未配置 DeepSeek API Key"}), 500

    msgs = list(analysis["messages"])
    msgs.append({"role": "user", "content": wrapped})

    print(f"[追问·流式] {analysis['item_name']}: {question[:50]}...")

    def generate():
        full_reply = ""
        try:
            resp = req_lib.post(
                "https://api.deepseek.com/chat/completions",
                headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": DEEPSEEK_CHAT_MODEL,
                    "messages": msgs,
                    "temperature": CHAT_TEMPERATURE,
                    "max_tokens": 8192,
                    "stream": True,
                },
                timeout=AI_TIMEOUT,
                stream=True,
            )
            if resp.status_code != 200:
                yield f"data: {json.dumps({'error': f'API 请求失败 (HTTP {resp.status_code})'})}\n\n"
                return

            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                chunk_str = line[6:]
                if chunk_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(chunk_str)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        full_reply += content
                        yield f"data: {json.dumps({'content': content})}\n\n"
                except json.JSONDecodeError:
                    continue

            msgs.append({"role": "assistant", "content": full_reply})
            analysis["messages"] = msgs
            shared._save_analysis_to_disk(analysis)

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': f'流式请求失败: {str(e)}'})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
