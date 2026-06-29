# -*- coding: utf-8 -*-
"""排行榜 API"""

import json
from flask import Blueprint, request, jsonify

rank_bp = Blueprint("rank", __name__)


@rank_bp.route("/api/rank", methods=["POST"])
def api_rank():
    """排行榜 — 代理 csqaq get_rank_list 接口"""
    import requests as req_lib
    from core.config import API_TOKEN

    data = request.get_json(force=True)
    filter_obj = data.get("filter") or {}
    page_index = data.get("page_index", 1)
    page_size = data.get("page_size", 30)
    search = data.get("search", "").strip() or None

    token = API_TOKEN
    if not token:
        return jsonify({"error": "未配置 API_TOKEN"}), 400

    payload = {"page_index": page_index, "page_size": page_size, "filter": filter_obj, "show_recently_price": True}
    if search:
        payload["search"] = search

    try:
        resp = req_lib.request(
            "POST",
            "https://api.csqaq.com/api/v1/info/get_rank_list",
            headers={"ApiToken": token, "Content-Type": "application/json"},
            data=json.dumps(payload).encode("utf-8"),
            timeout=15,
        )
        if resp.status_code != 200:
            return jsonify({"error": f"上游 API 返回 HTTP {resp.status_code}"}), 502
        body = resp.json()
        if body.get("code") != 200:
            return jsonify({"error": body.get("msg", "上游 API 业务错误")}), 502
        result = body.get("data", {})
        result["_msg"] = body.get("msg", "")
        print(f"[排行榜] page={page_index}, size={page_size}, filter={json.dumps(filter_obj, ensure_ascii=False)}, msg={body.get('msg')}, items={len(result.get('data', []))}")
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"请求失败: {e}"}), 500


@rank_bp.route("/api/rank/series", methods=["POST"])
def api_rank_series():
    """热门系列 — 代理 csqaq get_series_list 接口"""
    import requests as req_lib
    from core.config import API_TOKEN

    token = API_TOKEN
    if not token:
        return jsonify({"error": "未配置 API_TOKEN"}), 400

    try:
        resp = req_lib.request(
            "POST",
            "https://api.csqaq.com/api/v1/info/get_series_list",
            headers={"ApiToken": token, "Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code != 200:
            return jsonify({"error": f"上游 API 返回 HTTP {resp.status_code}"}), 502
        body = resp.json()
        if body.get("code") != 200:
            return jsonify({"error": body.get("msg", "上游 API 业务错误")}), 502
        data = body.get("data", [])
        print(f"[热门系列] items={len(data)}")
        return jsonify({"data": data, "_msg": body.get("msg", "")})
    except Exception as e:
        return jsonify({"error": f"请求失败: {e}"}), 500
