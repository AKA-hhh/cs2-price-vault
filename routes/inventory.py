# -*- coding: utf-8 -*-
"""Steam 库存 API"""

import os
import json
import time
from flask import Blueprint, request, jsonify
import shared

inventory_bp = Blueprint("inventory", __name__)


@inventory_bp.route("/api/inventory/fetch", methods=["POST"])
def api_inventory_fetch():
    from core.steam_client import parse_steam_id, get_steam_inventory

    data = request.get_json(force=True)
    raw_id = (data.get("steam_id") or "").strip()
    force_refresh = data.get("force", False)

    if not raw_id:
        return jsonify({"error": "请输入 Steam ID"}), 400

    steamid64, err = parse_steam_id(raw_id)
    if err:
        return jsonify({"error": err}), 400

    cache_key = steamid64
    if not force_refresh and cache_key in shared._inventory_cache:
        cached = shared._inventory_cache[cache_key]
        if time.time() - cached["timestamp"] < shared.INVENTORY_CACHE_TTL:
            items = cached["data"].get("items", [])
            if items and "name_cn" not in items[0]:
                shared._add_chinese_names(items)
                shared._save_inventory_file(shared._inventory_cache)
            return jsonify({"ok": True, "cached": True, "steam_id": steamid64, **cached["data"]})

    print(f"[库存] 正在拉取 SteamID: {steamid64}")

    inv = get_steam_inventory(steamid64)
    if not inv["success"]:
        return jsonify({"error": inv["error"] or "库存获取失败"}), 500

    items = inv["items"]
    total_count = inv["total_count"]

    shared._add_chinese_names(items)

    old_entry = shared._inventory_cache.get(cache_key)
    old_prices = {}
    if old_entry:
        for old_item in old_entry.get("data", {}).get("items", []):
            mhn = old_item.get("market_hash_name", "")
            if mhn and old_item.get("price"):
                old_prices[mhn] = {
                    "price": old_item["price"],
                    "change_pct": old_item.get("change_pct", 0),
                    "item_id": old_item.get("item_id", ""),
                }
    for item in items:
        mhn = item.get("market_hash_name", "")
        if mhn in old_prices:
            item["price"] = old_prices[mhn]["price"]
            item["change_pct"] = old_prices[mhn]["change_pct"]
            item["item_id"] = old_prices[mhn]["item_id"]

    seen = set()
    unique_items = []
    priced_count = 0
    total_value = 0.0
    for item in items:
        mhn = item.get("market_hash_name", "")
        if mhn not in seen:
            seen.add(mhn)
            unique_items.append(mhn)
        if item.get("price"):
            priced_count += 1
            total_value += item["price"] * item.get("amount", 1)

    result_data = {
        "items": items,
        "total_count": len(items),
        "unique_count": len(unique_items),
        "priced_count": priced_count,
        "total_value": round(total_value, 2),
        "costs": shared._inventory_cache.get(cache_key, {}).get("data", {}).get("costs", {}),
    }
    shared._inventory_cache[cache_key] = {"data": result_data, "timestamp": time.time()}
    shared._save_inventory_file(shared._inventory_cache)

    if total_count != len(items):
        print(f"[库存] Steam报 {total_count} 件, 实际解析 {len(items)} 件 ({len(unique_items)} 种, {total_count - len(items)} 件未匹配)")
    else:
        print(f"[库存] 共 {len(items)} 件物品, {len(unique_items)} 种唯一物品")

    return jsonify({"ok": True, "cached": False, "steam_id": steamid64, **result_data})


@inventory_bp.route("/api/inventory/prices", methods=["POST"])
def api_inventory_prices():
    from core.steam_client import lookup_prices_batch

    data = request.get_json(force=True)
    steam_id = (data.get("steam_id") or "").strip()

    cache_key = None
    if steam_id and steam_id in shared._inventory_cache:
        cache_key = steam_id
    elif shared._inventory_cache:
        cache_key = list(shared._inventory_cache.keys())[-1]

    if not cache_key:
        return jsonify({"error": "没有缓存数据，请先获取库存"}), 400

    inv = shared._inventory_cache[cache_key]["data"]
    items = inv["items"]

    seen = {}
    mhn_amounts = {}
    for item in items:
        mhn = item.get("market_hash_name", "")
        amt = item.get("amount", 1)
        if mhn:
            mhn_amounts[mhn] = mhn_amounts.get(mhn, 0) + amt
            if mhn not in seen:
                seen[mhn] = item

    total = len(seen)
    unique_names = list(seen.keys())
    print(f"[价格] 批量查询 {total} 个唯一物品 ({len(unique_names) // 50 + 1} 批)...")

    prices = lookup_prices_batch(unique_names)

    priced_count = 0
    total_value = 0.0
    for mhn, item in seen.items():
        p = prices.get(mhn)
        if p and p.get("price"):
            priced_count += 1
            total_value += p["price"] * mhn_amounts.get(mhn, item.get("amount", 1))

    for item in items:
        mhn = item.get("market_hash_name", "")
        p = prices.get(mhn)
        if p:
            item["price"] = p["price"]
            item["buff_price"] = p.get("buff_price", 0)
            item["yyyp_price"] = p.get("yyyp_price", 0)
            item["steam_price"] = p.get("steam_price", 0)
            item["item_id"] = p.get("item_id", "")

    inv["priced_count"] = priced_count
    inv["total_value"] = round(total_value, 2)
    shared._inventory_cache[cache_key]["data"] = inv
    shared._save_inventory_file(shared._inventory_cache)

    print(f"[价格] 完成: {priced_count}/{total} 件已标价, 估值 ￥{total_value:.2f}")

    return jsonify({
        "ok": True,
        "prices": prices,
        "priced_count": priced_count,
        "total_value": round(total_value, 2),
    })


@inventory_bp.route("/api/inventory/cached", methods=["GET"])
def api_inventory_cached():
    steam_id = request.args.get("steam_id", "").strip()
    cached = None
    sid = steam_id
    if steam_id and steam_id in shared._inventory_cache:
        cached = shared._inventory_cache[steam_id]
    elif shared._inventory_cache:
        sid = list(shared._inventory_cache.keys())[-1]
        cached = shared._inventory_cache[sid]
    if cached:
        items = cached["data"].get("items", [])
        if items and "name_cn" not in items[0]:
            shared._add_chinese_names(items)
        resp = {"ok": True, "steam_id": sid, **cached["data"]}
        if cached.get("sparklines"):
            resp["sparklines"] = cached["sparklines"]
        return jsonify(resp)
    return jsonify({"ok": True, "items": [], "total_count": 0, "priced_count": 0, "total_value": 0})


@inventory_bp.route("/api/inventory/clear", methods=["POST"])
def api_inventory_clear():
    shared._inventory_cache.clear()
    shared._save_inventory_file({})
    return jsonify({"ok": True})


@inventory_bp.route("/api/inventory/bind", methods=["POST"])
def api_inventory_bind():
    from core.steam_client import parse_steam_id
    data = request.get_json(force=True)
    raw_id = (data.get("steam_id") or "").strip()
    if not raw_id:
        return jsonify({"error": "请输入 Steam ID"}), 400
    steamid64, err = parse_steam_id(raw_id)
    if err:
        return jsonify({"error": err}), 400
    binding = {"steam_id": steamid64, "raw": raw_id}
    with open(os.path.join(shared.BASE_DIR, "inventory_binding.json"), "w", encoding="utf-8") as f:
        json.dump(binding, f, ensure_ascii=False, indent=2)
    return jsonify({"ok": True, "steam_id": steamid64})


@inventory_bp.route("/api/inventory/binding", methods=["GET"])
def api_inventory_binding():
    bp = os.path.join(shared.BASE_DIR, "inventory_binding.json")
    if os.path.exists(bp):
        try:
            with open(bp, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
        except (json.JSONDecodeError, IOError):
            pass
    return jsonify({"steam_id": "", "raw": ""})


@inventory_bp.route("/api/inventory/cost", methods=["POST"])
def api_inventory_cost():
    data = request.get_json(force=True)
    steam_id = (data.get("steam_id") or "").strip()
    assetid = str(data.get("assetid") or "")
    cost = data.get("cost")

    if not steam_id or not assetid:
        return jsonify({"error": "缺少参数"}), 400

    if steam_id not in shared._inventory_cache:
        shared._inventory_cache[steam_id] = {"data": {"items": [], "costs": {}}, "timestamp": 0}

    entry = shared._inventory_cache[steam_id]
    if "costs" not in entry["data"]:
        entry["data"]["costs"] = {}

    if cost is None or cost == "":
        entry["data"]["costs"].pop(assetid, None)
    else:
        try:
            entry["data"]["costs"][assetid] = round(float(cost), 2)
        except (ValueError, TypeError):
            return jsonify({"error": "无效的价格"}), 400

    shared._save_inventory_file(shared._inventory_cache)

    items = entry["data"].get("items", [])
    costs = entry["data"].get("costs", {})
    total_cost = 0.0
    total_value = 0.0
    for item in items:
        aid = item.get("assetid", "")
        c = costs.get(aid, 0)
        total_cost += c * item.get("amount", 1)
        if item.get("price"):
            total_value += item["price"] * item.get("amount", 1)

    return jsonify({
        "ok": True,
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
        "pnl": round(total_value - total_cost, 2),
    })


@inventory_bp.route("/api/inventory/sparklines", methods=["POST"])
def api_inventory_sparklines():
    import requests as req_lib
    from core.config import API_TOKEN

    data = request.get_json(force=True)
    item_ids = data.get("item_ids") or []
    steam_id = (data.get("steam_id") or "").strip()
    if not item_ids:
        return jsonify({"sparklines": {}})

    token = API_TOKEN
    cache_key = steam_id or (list(shared._inventory_cache.keys())[-1] if shared._inventory_cache else None)

    if not token:
        result = {}
        if cache_key and cache_key in shared._inventory_cache:
            cached_sp = shared._inventory_cache[cache_key].get("sparklines", {})
            for gid in item_ids:
                prices = cached_sp.get(str(gid))
                if prices:
                    result[str(gid)] = prices
        return jsonify({"sparklines": result})

    result = {}
    headers = {"ApiToken": token, "Content-Type": "application/json"}

    for i, gid in enumerate(item_ids):
        try:
            payload = json.dumps({
                "good_id": str(gid),
                "key": "sell_price",
                "platform": 2,
                "period": "7",
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

    if result and cache_key:
        if cache_key not in shared._inventory_cache:
            shared._inventory_cache[cache_key] = {"data": {"items": [], "costs": {}}, "timestamp": 0}
        existing = shared._inventory_cache[cache_key].get("sparklines", {})
        existing.update(result)
        shared._inventory_cache[cache_key]["sparklines"] = existing
        shared._inventory_cache[cache_key]["sparklines_ts"] = time.time()
        shared._save_inventory_file(shared._inventory_cache)

    return jsonify({"sparklines": result})
