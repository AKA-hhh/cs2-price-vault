# -*- coding: utf-8 -*-
"""分析会话管理 API"""

from flask import Blueprint, request, jsonify
import shared

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.route("/api/sessions", methods=["GET"])
def api_sessions_list():
    user_data = shared._get_user_data()
    analyses = sorted(user_data["analyses"].values(), key=lambda a: a["created_at"], reverse=True)
    return jsonify({
        "active_id": user_data.get("active_id"),
        "analyses": [shared._analysis_to_summary(a) for a in analyses],
    })


@sessions_bp.route("/api/session/switch", methods=["POST"])
def api_session_switch():
    data = request.get_json(force=True)
    analysis_id = (data.get("analysis_id") or "").strip()
    if not analysis_id:
        return jsonify({"error": "缺少 analysis_id"}), 400

    user_data = shared._get_user_data()
    analysis = user_data["analyses"].get(analysis_id)
    if not analysis:
        return jsonify({"error": "会话不存在或已过期"}), 404

    with shared.SESSION_LOCK:
        user_data["active_id"] = analysis_id

    msgs = analysis.get("messages") or []
    chat_msgs = msgs[3:] if len(msgs) > 3 else []
    return jsonify({
        "analysis_id": analysis["id"],
        "item_name": analysis["item_name"],
        "item_id": analysis["item_id"],
        "period_days": analysis["period_days"],
        "chart_b64": analysis["chart_b64"],
        "chart_html": analysis.get("chart_html", ""),
        "recommendation": analysis["recommendation"],
        "detail": analysis["detail"],
        "ai_analysis": analysis["ai_analysis"],
        "can_chat": len(msgs) > 0,
        "chat_messages": chat_msgs,
    })


@sessions_bp.route("/api/session/delete", methods=["POST"])
def api_session_delete():
    data = request.get_json(force=True)
    analysis_id = (data.get("analysis_id") or "").strip()
    if not analysis_id:
        return jsonify({"error": "缺少 analysis_id"}), 400

    user_data = shared._get_user_data()
    with shared.SESSION_LOCK:
        if analysis_id in user_data["analyses"]:
            del user_data["analyses"][analysis_id]
            shared._delete_analysis_from_disk(analysis_id)
        if user_data["active_id"] == analysis_id:
            remaining = sorted(user_data["analyses"].values(), key=lambda a: a["created_at"], reverse=True)
            user_data["active_id"] = remaining[0]["id"] if remaining else None

    return jsonify({"ok": True, "active_id": user_data.get("active_id")})


@sessions_bp.route("/api/session/current", methods=["GET"])
def api_session_current():
    user_data = shared._get_user_data()
    aid = user_data.get("active_id")
    if not aid:
        return jsonify({"active": False})
    analysis = user_data["analyses"].get(aid)
    if not analysis:
        return jsonify({"active": False})
    msgs = analysis.get("messages") or []
    chat_msgs = msgs[3:] if len(msgs) > 3 else []
    return jsonify({
        "active": True,
        "analysis_id": analysis["id"],
        "item_name": analysis["item_name"],
        "item_id": analysis["item_id"],
        "period_days": analysis["period_days"],
        "chart_b64": analysis["chart_b64"],
        "recommendation": analysis["recommendation"],
        "detail": analysis["detail"],
        "ai_analysis": analysis["ai_analysis"],
        "can_chat": len(msgs) > 0,
        "chat_messages": chat_msgs,
    })
