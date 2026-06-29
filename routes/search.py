# -*- coding: utf-8 -*-
"""搜索 + 大盘 API"""

from flask import Blueprint, request, jsonify
import shared
from core.id_map import search_item
from core.api_client import get_market_overview

search_bp = Blueprint("search", __name__)


@search_bp.route("/api/search", methods=["POST"])
def api_search():
    data = request.get_json(force=True)
    keyword = (data.get("keyword") or "").strip()
    if not keyword or len(keyword) < 2:
        return jsonify({"matches": []})
    matches = search_item(keyword, shared.name_to_id, shared.market_to_id)
    return jsonify({"matches": [{"name": n, "id": i} for n, i in matches[:12]]})


@search_bp.route("/api/market/overview", methods=["GET"])
def api_market_overview():
    data = get_market_overview()
    if data is None:
        return jsonify({"error": "获取大盘数据失败"}), 500
    return jsonify(data)
