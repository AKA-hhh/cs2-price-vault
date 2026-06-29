# -*- coding: utf-8 -*-
"""自选列表 CRUD API"""

from datetime import datetime
from flask import Blueprint, request, jsonify
import shared
from core.api_client import get_item_detail

watchlist_bp = Blueprint("watchlist", __name__)


@watchlist_bp.route("/api/watchlist", methods=["GET"])
def api_watchlist():
    return jsonify(shared._load_watchlist())


@watchlist_bp.route("/api/watchlist/refresh", methods=["POST"])
def api_watchlist_refresh():
    wl = shared._load_watchlist()
    if not wl:
        return jsonify([])

    updated = []
    for item in wl:
        try:
            detail = get_item_detail(int(item["id"]))
            if detail:
                item["price"] = detail.get("yyyp_sell_price", 0)
                item["chg_1d"] = detail.get("yyyp_sell_price_rate_1", 0)
                item["chg_7d"] = detail.get("yyyp_sell_price_rate_7", 0)
                item["sell_num"] = detail.get("yyyp_sell_num", 0)
                item["buy_price"] = detail.get("yyyp_buy_price", 0)
                item["chg_30d"] = detail.get("yyyp_sell_price_rate_30", 0)
                item["name"] = detail.get("name", item.get("name", ""))
                item["img"] = detail.get("img", "")
                item["updated_at"] = datetime.now().isoformat()
        except Exception as e:
            print(f"  [自选] 刷新 {item.get('name', item['id'])} 失败: {e}")
        updated.append(item)

    shared._save_watchlist(updated)
    return jsonify(updated)


@watchlist_bp.route("/api/watchlist/add", methods=["POST"])
def api_watchlist_add():
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    item_name = data.get("item_name", "")

    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    wl = shared._load_watchlist()
    if any(str(w.get("id")) == item_id for w in wl):
        return jsonify({"error": "已在自选列表中"}), 409

    detail = get_item_detail(int(item_id))
    added_price = detail.get("yyyp_sell_price", 0) if detail else 0
    added_at = datetime.now().isoformat()
    new_item = {
        "id": item_id,
        "name": detail.get("name", item_name) if detail else item_name,
        "added_at": added_at,
        "added_price": added_price,
        "price": added_price,
        "chg_1d": detail.get("yyyp_sell_price_rate_1", 0) if detail else 0,
        "chg_7d": detail.get("yyyp_sell_price_rate_7", 0) if detail else 0,
        "sell_num": detail.get("yyyp_sell_num", 0) if detail else 0,
        "buy_price": detail.get("yyyp_buy_price", 0) if detail else 0,
        "chg_30d": detail.get("yyyp_sell_price_rate_30", 0) if detail else 0,
        "img": detail.get("img", "") if detail else "",
        "updated_at": datetime.now().isoformat(),
    }
    wl.append(new_item)
    shared._save_watchlist(wl)
    return jsonify(new_item)


@watchlist_bp.route("/api/watchlist/remove", methods=["POST"])
def api_watchlist_remove():
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    wl = shared._load_watchlist()
    wl = [w for w in wl if str(w.get("id")) != item_id]
    shared._save_watchlist(wl)
    return jsonify({"ok": True})


@watchlist_bp.route("/api/watchlist/sparklines", methods=["POST"])
def api_watchlist_sparklines():
    import json
    import time
    import requests as req_lib
    from core.config import API_TOKEN

    data = request.get_json(force=True)
    item_ids = data.get("item_ids") or []
    if not item_ids:
        return jsonify({"sparklines": {}})

    token = API_TOKEN
    if not token:
        return jsonify({"sparklines": {}})

    result = {}
    headers = {"ApiToken": token, "Content-Type": "application/json"}

    for i, gid in enumerate(item_ids):
        try:
            payload = json.dumps({
                "good_id": str(gid),
                "key": "sell_price",
                "platform": 2,
                "period": "30",
                "style": "all_style",
            })
            resp = req_lib.request(
                "POST",
                "https://api.csqaq.com/api/v1/info/chart",
                headers=headers,
                data=payload.encode("utf-8"),
                timeout=10,
            )
            if resp.status_code == 200:
                body = resp.json()
                if body.get("code") == 200:
                    raw = body.get("data", {})
                    prices = raw.get("main_data", [])
                    if prices:
                        result[str(gid)] = [float(p) for p in prices if p is not None]
            if i < len(item_ids) - 1:
                time.sleep(0.35)
        except Exception:
            continue

    return jsonify({"sparklines": result})
