# -*- coding: utf-8 -*-
"""提示词管理 API"""

from flask import Blueprint, request, jsonify
from core.prompts import prompt_mgr

prompts_bp = Blueprint("prompts", __name__)


@prompts_bp.route("/api/prompts", methods=["GET"])
def api_prompts_get():
    return jsonify(prompt_mgr.get_all())


@prompts_bp.route("/api/prompts/<key>/active", methods=["PUT"])
def api_prompts_set_active(key):
    data = request.get_json(force=True)
    tid = (data.get("id") or "").strip()
    if not tid:
        return jsonify({"error": "缺少模板 id"}), 400
    ok = prompt_mgr.set_active(key, tid)
    if not ok:
        return jsonify({"error": "模板不存在"}), 404
    return jsonify({"ok": True})


@prompts_bp.route("/api/prompts/<key>/templates", methods=["POST"])
def api_prompts_add_template(key):
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    text = (data.get("text") or "").strip()
    if not name or not text:
        return jsonify({"error": "名称和内容不能为空"}), 400
    tid = prompt_mgr.add_template(key, name, text)
    if tid is None:
        return jsonify({"error": "未知的提示词 key"}), 404
    return jsonify({"id": tid, "name": name})


@prompts_bp.route("/api/prompts/<key>/templates/<tid>", methods=["PUT"])
def api_prompts_update_template(key, tid):
    data = request.get_json(force=True)
    name = data.get("name", "").strip() or None
    text = data.get("text", "").strip() or None
    ok = prompt_mgr.update_template(key, tid, name=name, text=text)
    if not ok:
        return jsonify({"error": "模板不存在或为内置模板，无法修改"}), 400
    return jsonify({"ok": True})


@prompts_bp.route("/api/prompts/<key>/templates/<tid>", methods=["DELETE"])
def api_prompts_delete_template(key, tid):
    ok = prompt_mgr.delete_template(key, tid)
    if not ok:
        return jsonify({"error": "无法删除（不存在或为内置模板）"}), 400
    return jsonify({"ok": True})
