# -*- coding: utf-8 -*-
"""AI 追问 API (同步 + SSE 流式)"""

import json
from flask import Blueprint, request, jsonify, Response
import shared
from core.ai_analysis import chat_with_context

chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(force=True)
    question = (data.get("question") or "").strip()
    analysis_id = (data.get("analysis_id") or "").strip()
    if not question:
        return jsonify({"error": "问题不能为空"}), 400

    user_data = shared._get_user_data()
    if not analysis_id:
        analysis_id = user_data.get("active_id")

    analysis = user_data["analyses"].get(analysis_id) if analysis_id else None
    if not analysis or not analysis.get("messages"):
        return jsonify({"error": "分析会话不存在或已过期"}), 400

    print(f"[追问] {analysis['item_name']}: {question[:50]}...")

    ok, reply = chat_with_context(analysis["messages"], question)

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
    if not question:
        return jsonify({"error": "问题不能为空"}), 400

    user_data = shared._get_user_data()
    if not analysis_id:
        analysis_id = user_data.get("active_id")

    analysis = user_data["analyses"].get(analysis_id) if analysis_id else None
    if not analysis or not analysis.get("messages"):
        return jsonify({"error": "分析会话不存在或已过期"}), 400

    if not DEEPSEEK_API_KEY:
        return jsonify({"error": "未配置 DeepSeek API Key"}), 500

    msgs = list(analysis["messages"])
    msgs.append({"role": "user", "content": question})

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
