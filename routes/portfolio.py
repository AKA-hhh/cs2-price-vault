# -*- coding: utf-8 -*-
"""持仓 CRUD + AI 建议 API"""

from datetime import datetime
from flask import Blueprint, request, jsonify
import shared
from core.api_client import get_item_detail
from core.prompts import prompt_mgr

portfolio_bp = Blueprint("portfolio", __name__)


@portfolio_bp.route("/api/portfolio", methods=["GET"])
def api_portfolio():
    return jsonify(shared._load_portfolio())


@portfolio_bp.route("/api/portfolio/refresh", methods=["POST"])
def api_portfolio_refresh():
    pf = shared._load_portfolio()
    for item in pf:
        try:
            detail = get_item_detail(int(item["id"]))
            if detail:
                item["current_price"] = detail.get("yyyp_sell_price", 0)
                item["name"] = detail.get("name", item.get("name", ""))
                item["img"] = detail.get("img", "")
                item["updated_at"] = datetime.now().isoformat()
        except Exception as e:
            print(f"  [持仓] 刷新 {item.get('name', item['id'])} 失败: {e}")

    shared._save_portfolio(pf)
    return jsonify(pf)


@portfolio_bp.route("/api/portfolio/add", methods=["POST"])
def api_portfolio_add():
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    item_name = data.get("item_name", "")
    buy_price = float(data.get("buy_price", 0))
    quantity = int(data.get("quantity", 1))

    if not item_id or buy_price <= 0:
        return jsonify({"error": "参数不完整"}), 400

    pf = shared._load_portfolio()
    if any(str(p.get("id")) == item_id for p in pf):
        return jsonify({"error": "已在持仓中"}), 409

    detail = get_item_detail(int(item_id))
    current_price = detail.get("yyyp_sell_price", 0) if detail else 0

    new_item = {
        "id": item_id,
        "name": detail.get("name", item_name) if detail else item_name,
        "img": detail.get("img", "") if detail else "",
        "buy_price": buy_price,
        "quantity": quantity,
        "current_price": current_price,
        "added_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    pf.append(new_item)
    shared._save_portfolio(pf)
    return jsonify(new_item)


@portfolio_bp.route("/api/portfolio/update", methods=["POST"])
def api_portfolio_update():
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    buy_price = data.get("buy_price")
    quantity = data.get("quantity")

    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    pf = shared._load_portfolio()
    item = next((p for p in pf if str(p.get("id")) == item_id), None)
    if not item:
        return jsonify({"error": "未找到该持仓"}), 404

    if buy_price is not None:
        item["buy_price"] = float(buy_price)
    if quantity is not None:
        item["quantity"] = int(quantity)

    item["updated_at"] = datetime.now().isoformat()
    shared._save_portfolio(pf)
    return jsonify(item)


@portfolio_bp.route("/api/portfolio/remove", methods=["POST"])
def api_portfolio_remove():
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400
    pf = shared._load_portfolio()
    pf = [p for p in pf if str(p.get("id")) != item_id]
    shared._save_portfolio(pf)
    return jsonify({"ok": True})


@portfolio_bp.route("/api/portfolio/advice", methods=["POST"])
def api_portfolio_advice():
    import requests as req_lib

    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    pf = shared._load_portfolio()
    holding = next((p for p in pf if str(p.get("id")) == item_id), None)
    if not holding:
        return jsonify({"error": "未找到该持仓"}), 404

    buy_price = holding.get("buy_price", 0)
    quantity = holding.get("quantity", 1)
    current_price = holding.get("current_price", 0)
    total_cost = buy_price * quantity
    current_value = current_price * quantity
    pnl = current_value - total_cost
    pnl_pct = (pnl / total_cost * 100) if total_cost > 0 else 0

    template = prompt_mgr.get("portfolio_advice")
    prompt = template.format(
        name=holding.get('name', 'ID:'+item_id),
        buy_price=buy_price,
        quantity=quantity,
        total_cost=total_cost,
        current_price=current_price,
        current_value=current_value,
        pnl=pnl,
        pnl_pct=pnl_pct,
    )

    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL, AI_TIMEOUT
    if not DEEPSEEK_API_KEY:
        return jsonify({"error": "未配置 DeepSeek API Key"}), 500

    try:
        resp = req_lib.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
            json={"model": DEEPSEEK_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.7},
            timeout=AI_TIMEOUT,
        )
        result = resp.json()
        text = result["choices"][0]["message"]["content"]
        return jsonify({"advice": text})
    except Exception as e:
        return jsonify({"error": f"AI 请求失败: {e}"}), 500
