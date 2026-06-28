# -*- coding: utf-8 -*-
"""
CS2 饰品价格分析桌面应用 — Flask 后端 v2.0
支持多会话历史侧边栏
"""

import matplotlib
matplotlib.use("Agg")

import os, io, sys, json, time, base64, uuid, threading
from datetime import datetime

import matplotlib.pyplot as plt
from flask import Flask, render_template, request, jsonify, session, Response

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from core.config import ID_MAP_FILE, PERIOD_PRESETS
from core.id_map import load_id_map, search_item
from core.api_client import get_item_price_history, get_item_detail, get_market_overview
from core.indicators import compute_indicators
from core.recommendation import generate_recommendation
from core.ai_analysis import get_ai_analysis, chat_with_context
from core.prompts import prompt_mgr
from core.visualization import plot_analysis
from core.visualization_plotly import plot_analysis as plot_analysis_plotly
from core.utils import extract_wear_level, sanitize_filename

app = Flask(__name__)
app.secret_key = os.urandom(24).hex()
app.config["TEMPLATES_AUTO_RELOAD"] = True

@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

print("正在加载饰品ID映射...")
name_to_id, market_to_id, id_to_name = load_id_map(ID_MAP_FILE)
print(f"已加载 {len(id_to_name)} 条饰品映射，服务就绪。")

# ── 本地库存缓存持久化 ──
INVENTORY_CACHE_FILE = os.path.join(BASE_DIR, "inventory.json")


def _load_inventory_file():
    if not os.path.exists(INVENTORY_CACHE_FILE):
        return {}
    try:
        with open(INVENTORY_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return {}
            return data
    except (json.JSONDecodeError, IOError):
        return {}


def _save_inventory_file(cache):
    slim = {}
    for sid, entry in cache.items():
        slim[sid] = {
            "data": entry.get("data", {}),
            "timestamp": entry.get("timestamp", 0),
        }
    with open(INVENTORY_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, indent=2)


def _add_chinese_names(items):
    """通过 id_map 为库存物品补充中文名"""
    import re as _re
    for item in items:
        mhn = item.get("market_hash_name", "")
        cn = None
        iid = market_to_id.get(mhn)
        if iid:
            cn = id_to_name.get(iid)
        if not cn and mhn:
            base = _re.sub(r'\s*\([^)]*\)\s*$', '', mhn).strip()
            base = _re.sub(r'^(StatTrak™\s*|★\s*)', '', base).strip()
            for mid_name, mid in market_to_id.items():
                if base.lower() == mid_name.lower():
                    cn = id_to_name.get(mid)
                    break
            if not cn:
                for mid_name, mid in market_to_id.items():
                    if base.lower() in mid_name.lower() or mid_name.lower() in base.lower():
                        cn = id_to_name.get(mid)
                        break
        item["name_cn"] = cn


# 从本地恢复库存缓存
_inventory_cache = _load_inventory_file()
if _inventory_cache:
    print(f"已恢复 {len(_inventory_cache)} 条库存缓存")

# ── 多会话存储 (内存 + 本地磁盘持久化) ──
HISTORY_DIR = os.path.join(BASE_DIR, "history")
os.makedirs(HISTORY_DIR, exist_ok=True)

# 内存结构: user_sessions[user_sid] = {
#     "active_id": "a1b2c3",
#     "analyses": { "a1b2c3": {...}, ... }
# }
user_sessions = {}
SESSION_LOCK = threading.Lock()
MAX_ANALYSES_PER_USER = 50


def _analysis_disk_path(aid):
    """分析记录的磁盘路径: history/{aid}.json + history/{aid}.png + history/{aid}_chart.html"""
    return (
        os.path.join(HISTORY_DIR, f"{aid}.json"),
        os.path.join(HISTORY_DIR, f"{aid}.png"),
        os.path.join(HISTORY_DIR, f"{aid}_chart.html"),
    )


def _save_analysis_to_disk(analysis):
    """将单条分析持久化到磁盘 (JSON + PNG)"""
    aid = analysis["id"]
    json_path, png_path, html_path = _analysis_disk_path(aid)
    try:
        # 保存图表为 PNG
        if analysis.get("chart_b64"):
            img_data = base64.b64decode(analysis["chart_b64"])
            with open(png_path, "wb") as f:
                f.write(img_data)
        # 保存交互式图表 HTML (Plotly)
        if analysis.get("chart_html"):
            try:
                with open(html_path, "w", encoding="utf-8") as f:
                    f.write(analysis["chart_html"])
            except Exception as e:
                print(f"  保存图表 HTML 失败 [{aid}]: {e}")
        # 保存元数据为 JSON (不含 base64 图片，太大)
        record = {
            "id": analysis["id"],
            "item_name": analysis["item_name"],
            "item_id": analysis["item_id"],
            "period_days": analysis["period_days"],
            "recommendation": analysis.get("recommendation", {}),
            "detail": analysis.get("detail", {}),
            "ai_analysis": analysis.get("ai_analysis", ""),
            "messages": analysis.get("messages") or [],
            "created_at": analysis["created_at"],
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
    except Exception as e:
        print(f"  保存分析到磁盘失败 [{aid}]: {e}")


def _delete_analysis_from_disk(aid):
    """删除磁盘上的分析记录"""
    json_path, png_path, html_path = _analysis_disk_path(aid)
    for p in (json_path, png_path, html_path):
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


def _load_analyses_from_disk():
    """启动时从 history/ 目录恢复所有分析到内存"""
    restored = {}
    try:
        for fname in os.listdir(HISTORY_DIR):
            if not fname.endswith(".json"):
                continue
            aid = fname[:-5]  # 去掉 .json
            json_path, png_path, html_path = _analysis_disk_path(aid)
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    record = json.load(f)
            except Exception:
                continue
            # 恢复 chart_b64
            chart_b64 = ""
            if os.path.exists(png_path):
                try:
                    with open(png_path, "rb") as f:
                        chart_b64 = base64.b64encode(f.read()).decode("utf-8")
                except Exception:
                    pass
            # 恢复 chart_html (Plotly 交互式图表)
            chart_html = ""
            if os.path.exists(html_path):
                try:
                    with open(html_path, "r", encoding="utf-8") as f:
                        chart_html = f.read()
                except Exception:
                    pass
            analysis = {
                "id": aid,
                "item_name": record.get("item_name", ""),
                "item_id": record.get("item_id", 0),
                "period_days": record.get("period_days", 90),
                "chart_b64": chart_b64,
                "chart_html": chart_html,
                "recommendation": record.get("recommendation", {}),
                "detail": record.get("detail", {}),
                "ai_analysis": record.get("ai_analysis", ""),
                "messages": record.get("messages") or [],
                "created_at": record.get("created_at", 0),
            }
            restored[aid] = analysis
    except Exception as e:
        print(f"加载历史记录失败: {e}")

    # 按创建时间排序
    sorted_items = sorted(restored.values(), key=lambda a: a["created_at"], reverse=True)
    print(f"从磁盘恢复 {len(sorted_items)} 条分析历史")
    return restored, sorted_items[0]["id"] if sorted_items else None


# 启动时加载历史
_disk_analyses, _disk_active = _load_analyses_from_disk()
# 用一个全局默认用户承载所有历史（桌面单用户场景）
_DEFAULT_USER = "_local_"
user_sessions[_DEFAULT_USER] = {
    "active_id": _disk_active,
    "analyses": _disk_analyses,
}


def _get_user_data():
    """获取本地默认用户的数据容器"""
    return user_sessions[_DEFAULT_USER]


def _fig_to_base64(fig=None):
    if fig is None:
        fig = plt.gcf()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("utf-8")
    plt.close(fig)
    buf.close()
    return b64


def _plotly_fig_to_base64(fig):
    """将 Plotly figure 转为 base64 PNG 字符串"""
    try:
        img_bytes = fig.to_image(format="png", scale=2)
        return base64.b64encode(img_bytes).decode("utf-8")
    except ValueError as e:
        print(f"Plotly PNG 导出失败 (需安装 kaleido): {e}")
        return None


def _build_chart_html_page(fig):
    """将 Plotly figure 包装成完整的 HTML 文档（iframe 友好）"""
    # 不强制 responsive=false，让图表宽度自适应容器；高度由 layout.height 固定
    chart_div = fig.to_html(include_plotlyjs="cdn", full_html=False)
    return (
        '<!DOCTYPE html>\n'
        '<html lang="zh-CN">\n'
        '<head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<style>body{margin:0;padding:8px;background:#fff;font-family:"Microsoft YaHei","SimHei",sans-serif;}</style>'
        '</head>\n'
        f'<body>{chart_div}</body>\n'
        '</html>'
    )


def _build_chat_messages(df, item_name, period_days, recommendation, ai_text):
    from core.ai_analysis import _build_ai_prompt
    prompt = _build_ai_prompt(df, item_name, period_days, recommendation)
    return [
        {"role": "system", "content": prompt_mgr.get("chat_system")},
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": ai_text},
    ]


def _analysis_to_summary(a):
    """将分析对象转为侧边栏摘要"""
    rec = a.get("recommendation", {})
    ts = a.get("created_at", 0)
    # 显示查询时的绝对时间，不再变化
    dt = datetime.fromtimestamp(ts)
    time_str = dt.strftime("%m-%d %H:%M")
    return {
        "id": a["id"],
        "item_name": a["item_name"],
        "item_id": a["item_id"],
        "period_days": a["period_days"],
        "score": rec.get("score", 0),
        "action": rec.get("action", ""),
        "created_at": a["created_at"],
        "time_str": time_str,
    }


# ══════════════════════════════════════════════════════════════
@app.route("/")
def index():
    return render_template("index.html", period_presets=PERIOD_PRESETS)


@app.route("/api/search", methods=["POST"])
def api_search():
    data = request.get_json(force=True)
    keyword = (data.get("keyword") or "").strip()
    if not keyword or len(keyword) < 2:
        return jsonify({"matches": []})
    matches = search_item(keyword, name_to_id, market_to_id)
    return jsonify({"matches": [{"name": n, "id": i} for n, i in matches[:12]]})


@app.route("/api/market/overview", methods=["GET"])
def api_market_overview():
    """获取大盘概览数据"""
    # 缓存 60 秒，避免频繁请求
    data = get_market_overview()
    if data is None:
        return jsonify({"error": "获取大盘数据失败"}), 500
    return jsonify(data)


# ═══════════════════ 自选 Watchlist ═══════════════════

WATCHLIST_FILE = os.path.join(BASE_DIR, "watchlist.json")


def _load_watchlist():
    """读取自选列表"""
    if not os.path.exists(WATCHLIST_FILE):
        return []
    try:
        with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_watchlist(wl):
    """保存自选列表"""
    with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
        json.dump(wl, f, ensure_ascii=False, indent=2)


@app.route("/api/watchlist", methods=["GET"])
def api_watchlist():
    """获取自选列表（返回缓存数据）"""
    return jsonify(_load_watchlist())


@app.route("/api/watchlist/refresh", methods=["POST"])
def api_watchlist_refresh():
    """刷新所有自选饰品的最新价格"""
    wl = _load_watchlist()
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

    _save_watchlist(updated)
    return jsonify(updated)


@app.route("/api/watchlist/add", methods=["POST"])
def api_watchlist_add():
    """添加自选饰品"""
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    item_name = data.get("item_name", "")

    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    wl = _load_watchlist()
    # 检查是否已存在
    if any(str(w.get("id")) == item_id for w in wl):
        return jsonify({"error": "已在自选列表中"}), 409

    # 获取当前价格
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
    _save_watchlist(wl)
    return jsonify(new_item)


@app.route("/api/watchlist/remove", methods=["POST"])
def api_watchlist_remove():
    """移除自选饰品"""
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    wl = _load_watchlist()
    wl = [w for w in wl if str(w.get("id")) != item_id]
    _save_watchlist(wl)
    return jsonify({"ok": True})


# ═══════════════════ 持仓 Portfolio ═══════════════════

PORTFOLIO_FILE = os.path.join(BASE_DIR, "portfolio.json")


def _load_portfolio():
    if not os.path.exists(PORTFOLIO_FILE):
        return []
    try:
        with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_portfolio(pf):
    with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
        json.dump(pf, f, ensure_ascii=False, indent=2)


@app.route("/api/portfolio", methods=["GET"])
def api_portfolio():
    """获取持仓列表"""
    return jsonify(_load_portfolio())


@app.route("/api/portfolio/refresh", methods=["POST"])
def api_portfolio_refresh():
    """刷新持仓饰品当前价格（悠悠有品）"""
    pf = _load_portfolio()
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

    _save_portfolio(pf)
    return jsonify(pf)


@app.route("/api/portfolio/add", methods=["POST"])
def api_portfolio_add():
    """添加持仓"""
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    item_name = data.get("item_name", "")
    buy_price = float(data.get("buy_price", 0))
    quantity = int(data.get("quantity", 1))

    if not item_id or buy_price <= 0:
        return jsonify({"error": "参数不完整"}), 400

    pf = _load_portfolio()
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
    _save_portfolio(pf)
    return jsonify(new_item)


@app.route("/api/portfolio/update", methods=["POST"])
def api_portfolio_update():
    """更新持仓的买入价或数量"""
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    buy_price = data.get("buy_price")
    quantity = data.get("quantity")

    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    pf = _load_portfolio()
    item = next((p for p in pf if str(p.get("id")) == item_id), None)
    if not item:
        return jsonify({"error": "未找到该持仓"}), 404

    if buy_price is not None:
        item["buy_price"] = float(buy_price)
    if quantity is not None:
        item["quantity"] = int(quantity)

    item["updated_at"] = datetime.now().isoformat()
    _save_portfolio(pf)
    return jsonify(item)


@app.route("/api/portfolio/remove", methods=["POST"])
def api_portfolio_remove():
    """移除持仓"""
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400
    pf = _load_portfolio()
    pf = [p for p in pf if str(p.get("id")) != item_id]
    _save_portfolio(pf)
    return jsonify({"ok": True})


@app.route("/api/portfolio/advice", methods=["POST"])
def api_portfolio_advice():
    """对单个持仓请求 AI 建议"""
    import requests as req_lib
    data = request.get_json(force=True)
    item_id = str(data.get("item_id", ""))
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    pf = _load_portfolio()
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


# ═══════════════════ Steam 库存 ═══════════════════

INVENTORY_CACHE_TTL = 300  # 缓存有效期 (秒)


@app.route("/api/inventory/fetch", methods=["POST"])
def api_inventory_fetch():
    """输入 Steam ID → 拉取库存（不含价格，快速返回）"""
    from core.steam_client import parse_steam_id, get_steam_inventory

    data = request.get_json(force=True)
    raw_id = (data.get("steam_id") or "").strip()
    force_refresh = data.get("force", False)

    if not raw_id:
        return jsonify({"error": "请输入 Steam ID"}), 400

    # 解析 SteamID64
    steamid64, err = parse_steam_id(raw_id)
    if err:
        return jsonify({"error": err}), 400

    # 检查缓存
    cache_key = steamid64
    if not force_refresh and cache_key in _inventory_cache:
        cached = _inventory_cache[cache_key]
        if time.time() - cached["timestamp"] < INVENTORY_CACHE_TTL:
            # 缓存可能有旧数据没有 name_cn，补上
            items = cached["data"].get("items", [])
            if items and "name_cn" not in items[0]:
                _add_chinese_names(items)
                _save_inventory_file(_inventory_cache)
            return jsonify({"ok": True, "cached": True, "steam_id": steamid64, **cached["data"]})

    print(f"[库存] 正在拉取 SteamID: {steamid64}")

    # 拉取库存（不查价格）
    inv = get_steam_inventory(steamid64)
    if not inv["success"]:
        return jsonify({"error": inv["error"] or "库存获取失败"}), 500

    items = inv["items"]
    total_count = inv["total_count"]

    # 通过 id_map 匹配中文名称
    _add_chinese_names(items)

    # 保留旧缓存中已有的价格（按 market_hash_name 合并）
    old_entry = _inventory_cache.get(cache_key)
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

    # 去除重复市场名，统计唯一物品数和已标价
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
        "total_count": len(items),  # 实际解析成功数量，非 Steam 估算值
        "unique_count": len(unique_items),
        "priced_count": priced_count,
        "total_value": round(total_value, 2),
        "costs": _inventory_cache.get(cache_key, {}).get("data", {}).get("costs", {}),
    }
    _inventory_cache[cache_key] = {"data": result_data, "timestamp": time.time()}
    _save_inventory_file(_inventory_cache)

    if total_count != len(items):
        print(f"[库存] Steam报 {total_count} 件, 实际解析 {len(items)} 件 ({len(unique_items)} 种, {total_count - len(items)} 件未匹配)")
    else:
        print(f"[库存] 共 {len(items)} 件物品, {len(unique_items)} 种唯一物品")

    return jsonify({"ok": True, "cached": False, "steam_id": steamid64, **result_data})


@app.route("/api/inventory/prices", methods=["POST"])
def api_inventory_prices():
    """对已缓存的库存物品批量查询价格（csqaq 批量接口，50 个/次）"""
    from core.steam_client import lookup_prices_batch

    data = request.get_json(force=True)
    steam_id = (data.get("steam_id") or "").strip()

    # 找缓存
    cache_key = None
    if steam_id and steam_id in _inventory_cache:
        cache_key = steam_id
    elif _inventory_cache:
        cache_key = list(_inventory_cache.keys())[-1]

    if not cache_key:
        return jsonify({"error": "没有缓存数据，请先获取库存"}), 400

    inv = _inventory_cache[cache_key]["data"]
    items = inv["items"]

    # 去重：相同 market_hash_name 只查一次，同时统计总数
    seen = {}
    mhn_amounts = {}  # market_hash_name → 总数量
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

    # 批量查询价格
    prices = lookup_prices_batch(unique_names)

    priced_count = 0
    total_value = 0.0
    for mhn, item in seen.items():
        p = prices.get(mhn)
        if p and p.get("price"):
            priced_count += 1
            total_value += p["price"] * mhn_amounts.get(mhn, item.get("amount", 1))

    # 把价格写入缓存中的物品（持久化到 inventory.json）
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
    _inventory_cache[cache_key]["data"] = inv
    _save_inventory_file(_inventory_cache)

    print(f"[价格] 完成: {priced_count}/{total} 件已标价, 估值 ￥{total_value:.2f}")

    return jsonify({
        "ok": True,
        "prices": prices,
        "priced_count": priced_count,
        "total_value": round(total_value, 2),
    })


@app.route("/api/inventory/cached", methods=["GET"])
def api_inventory_cached():
    """获取已缓存的库存数据"""
    steam_id = request.args.get("steam_id", "").strip()
    cached = None
    sid = steam_id
    if steam_id and steam_id in _inventory_cache:
        cached = _inventory_cache[steam_id]
    elif _inventory_cache:
        sid = list(_inventory_cache.keys())[-1]
        cached = _inventory_cache[sid]
    if cached:
        items = cached["data"].get("items", [])
        if items and "name_cn" not in items[0]:
            _add_chinese_names(items)
        return jsonify({"ok": True, "steam_id": sid, **cached["data"]})
    return jsonify({"ok": True, "items": [], "total_count": 0, "priced_count": 0, "total_value": 0})


@app.route("/api/inventory/clear", methods=["POST"])
def api_inventory_clear():
    """清除库存缓存"""
    _inventory_cache.clear()
    _save_inventory_file({})
    return jsonify({"ok": True})


@app.route("/api/inventory/bind", methods=["POST"])
def api_inventory_bind():
    """绑定/更新 Steam ID"""
    from core.steam_client import parse_steam_id
    data = request.get_json(force=True)
    raw_id = (data.get("steam_id") or "").strip()
    if not raw_id:
        return jsonify({"error": "请输入 Steam ID"}), 400
    steamid64, err = parse_steam_id(raw_id)
    if err:
        return jsonify({"error": err}), 400
    # 保存绑定信息
    binding = {"steam_id": steamid64, "raw": raw_id}
    with open(os.path.join(BASE_DIR, "inventory_binding.json"), "w", encoding="utf-8") as f:
        json.dump(binding, f, ensure_ascii=False, indent=2)
    return jsonify({"ok": True, "steam_id": steamid64})


@app.route("/api/inventory/binding", methods=["GET"])
def api_inventory_binding():
    """获取当前绑定的 Steam ID"""
    bp = os.path.join(BASE_DIR, "inventory_binding.json")
    if os.path.exists(bp):
        try:
            with open(bp, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
        except (json.JSONDecodeError, IOError):
            pass
    return jsonify({"steam_id": "", "raw": ""})


@app.route("/api/inventory/cost", methods=["POST"])
def api_inventory_cost():
    """设置某件物品的成本价"""
    data = request.get_json(force=True)
    steam_id = (data.get("steam_id") or "").strip()
    assetid = str(data.get("assetid") or "")
    cost = data.get("cost")  # None 表示清除

    if not steam_id or not assetid:
        return jsonify({"error": "缺少参数"}), 400

    # 确保缓存中有这个 steam_id 的条目
    if steam_id not in _inventory_cache:
        _inventory_cache[steam_id] = {"data": {"items": [], "costs": {}}, "timestamp": 0}

    entry = _inventory_cache[steam_id]
    if "costs" not in entry["data"]:
        entry["data"]["costs"] = {}

    if cost is None or cost == "":
        entry["data"]["costs"].pop(assetid, None)
    else:
        try:
            entry["data"]["costs"][assetid] = round(float(cost), 2)
        except (ValueError, TypeError):
            return jsonify({"error": "无效的价格"}), 400

    _save_inventory_file(_inventory_cache)

    # 计算总成本和盈亏
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


# ═══════════════════ 多平台比价 ═══════════════════

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(force=True)
    item_id = data.get("item_id")
    period_days = data.get("period_days", 90)
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    item_name = id_to_name.get(int(item_id), f"ID:{item_id}")
    print(f"[分析] {item_name} (ID:{item_id}), {period_days}天")

    df = get_item_price_history(int(item_id), period_days)
    if df is None or df.empty:
        return jsonify({"error": f"获取 [{item_name}] 价格数据失败"}), 500

    print(f"  获取 {len(df)} 条价格数据")
    df = compute_indicators(df)
    recommendation = generate_recommendation(df)
    detail = get_item_detail(int(item_id)) or {}
    # 匹配知识库，注入 AI 分析
    kb_entries = _load_kb()
    relevant_kb = match_knowledge(item_name, kb_entries) if kb_entries else []
    ai_ok, ai_text = get_ai_analysis(df, item_name, period_days, recommendation, relevant_kb)
    if ai_ok is None:
        print(f"  AI 分析失败: {ai_text}")
    elif ai_ok is False:
        print(f"  AI 分析跳过: {ai_text[:80]}...")

    # 图表：根据设置选择引擎 (默认 matplotlib)
    ui = _load_ui_settings()
    chart_engine = ui.get("chart_engine", "matplotlib")
    chart_html = ""  # Plotly 交互式 HTML

    if chart_engine == "plotly":
        plotly_fig = plot_analysis_plotly(df, item_name, period_days, recommendation, show=False)
        chart_b64 = _plotly_fig_to_base64(plotly_fig) if plotly_fig else ""
        if plotly_fig:
            try:
                chart_html = _build_chart_html_page(plotly_fig)
            except Exception as e:
                print(f"  生成 Plotly HTML 失败: {e}")
        if not chart_b64:
            # kaleido 未安装，回退到 matplotlib
            print("  Plotly 回退到 matplotlib (kaleido 未安装)")
            plot_analysis(df, item_name, period_days, recommendation, show=False)
            chart_b64 = _fig_to_base64()
    else:
        plot_analysis(df, item_name, period_days, recommendation, show=False)
        chart_b64 = _fig_to_base64()

    # 保存到磁盘
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = sanitize_filename(item_name)
    wear = extract_wear_level(item_name)
    filename = f"{now_str}_{safe_name}"
    if wear:
        filename += f"_{wear}"
    filename += f"_{period_days}d_analysis"
    save_path = os.path.join(BASE_DIR, "analysis_output", filename)
    try:
        if chart_engine == "plotly":
            save_path_png = save_path + ".png"
            plotly_fig2 = plot_analysis_plotly(df, item_name, period_days, recommendation, save_path=save_path_png, show=False)
        else:
            save_path_png = save_path + ".png"
            plot_analysis(df, item_name, period_days, recommendation, show=False)
            plt.savefig(save_path_png, dpi=150, bbox_inches="tight")
            plt.close()
    except Exception as e:
        print(f"  保存图表失败: {e}")

    # 对话历史
    messages = None
    if ai_ok is True:
        try:
            messages = _build_chat_messages(df, item_name, period_days, recommendation, ai_text)
        except Exception as e:
            print(f"  构建对话历史失败: {e}")

    # 存入多会话结构
    analysis_id = uuid.uuid4().hex[:10]
    user_data = _get_user_data()

    analysis_entry = {
        "id": analysis_id,
        "item_name": item_name,
        "item_id": int(item_id),
        "period_days": period_days,
        "chart_b64": chart_b64,
        "chart_html": chart_html,
        "recommendation": recommendation,
        "detail": detail,
        "ai_analysis": ai_text if (ai_ok is True or ai_ok is False) else "",
        "messages": messages,
        "created_at": time.time(),
    }

    with SESSION_LOCK:
        user_data["analyses"][analysis_id] = analysis_entry
        user_data["active_id"] = analysis_id
        # 限制历史数量，超出则删除最旧的（内存 + 磁盘）
        if len(user_data["analyses"]) > MAX_ANALYSES_PER_USER:
            oldest = sorted(user_data["analyses"].values(), key=lambda a: a["created_at"])[0]
            del user_data["analyses"][oldest["id"]]
            _delete_analysis_from_disk(oldest["id"])

    # 持久化到磁盘
    _save_analysis_to_disk(analysis_entry)

    # 提取追问消息（跳过 system + 初始 prompt + 初始回复，只保留后续对话）
    chat_msgs = messages[3:] if messages and len(messages) > 3 else []

    return jsonify({
        "analysis_id": analysis_id,
        "item_name": item_name,
        "item_id": int(item_id),
        "period_days": period_days,
        "chart_b64": chart_b64,
        "chart_html": chart_html,
        "recommendation": recommendation,
        "detail": detail,
        "ai_analysis": ai_text if (ai_ok is True or ai_ok is False) else "",
        "ai_error": ai_text if ai_ok is None else None,
        "can_chat": messages is not None,
        "chat_messages": chat_msgs,
    })


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(force=True)
    question = (data.get("question") or "").strip()
    analysis_id = (data.get("analysis_id") or "").strip()
    if not question:
        return jsonify({"error": "问题不能为空"}), 400

    user_data = _get_user_data()
    if not analysis_id:
        analysis_id = user_data.get("active_id")

    analysis = user_data["analyses"].get(analysis_id) if analysis_id else None
    if not analysis or not analysis.get("messages"):
        return jsonify({"error": "分析会话不存在或已过期"}), 400

    # created_at 保持不变，不更新
    print(f"[追问] {analysis['item_name']}: {question[:50]}...")

    ok, reply = chat_with_context(analysis["messages"], question)

    if ok is True:
        _save_analysis_to_disk(analysis)  # 同步最新的 messages 到磁盘
        msgs = analysis.get("messages") or []
        chat_msgs = msgs[3:] if len(msgs) > 3 else []
        return jsonify({"reply": reply, "analysis_id": analysis_id, "chat_messages": chat_msgs})
    elif ok is False:
        return jsonify({"reply": reply, "analysis_id": analysis_id})
    else:
        return jsonify({"error": reply}), 500


@app.route("/api/chat/stream", methods=["POST"])
def api_chat_stream():
    """流式追问 — SSE 实时输出"""
    import requests as req_lib
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_CHAT_MODEL, CHAT_TEMPERATURE, AI_TIMEOUT

    data = request.get_json(force=True)
    question = (data.get("question") or "").strip()
    analysis_id = (data.get("analysis_id") or "").strip()
    if not question:
        return jsonify({"error": "问题不能为空"}), 400

    user_data = _get_user_data()
    if not analysis_id:
        analysis_id = user_data.get("active_id")

    analysis = user_data["analyses"].get(analysis_id) if analysis_id else None
    if not analysis or not analysis.get("messages"):
        return jsonify({"error": "分析会话不存在或已过期"}), 400

    if not DEEPSEEK_API_KEY:
        return jsonify({"error": "未配置 DeepSeek API Key"}), 500

    msgs = list(analysis["messages"])  # shallow copy
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
                chunk_str = line[6:]  # strip "data: "
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

            # Save to messages after stream completes
            msgs.append({"role": "assistant", "content": full_reply})
            analysis["messages"] = msgs
            _save_analysis_to_disk(analysis)

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


@app.route("/api/sessions", methods=["GET"])
def api_sessions_list():
    """列出当前用户的所有分析历史（侧边栏用）"""
    user_data = _get_user_data()
    analyses = sorted(user_data["analyses"].values(), key=lambda a: a["created_at"], reverse=True)
    return jsonify({
        "active_id": user_data.get("active_id"),
        "analyses": [_analysis_to_summary(a) for a in analyses],
    })


@app.route("/api/session/switch", methods=["POST"])
def api_session_switch():
    """切换到指定分析会话"""
    data = request.get_json(force=True)
    analysis_id = (data.get("analysis_id") or "").strip()
    if not analysis_id:
        return jsonify({"error": "缺少 analysis_id"}), 400

    user_data = _get_user_data()
    analysis = user_data["analyses"].get(analysis_id)
    if not analysis:
        return jsonify({"error": "会话不存在或已过期"}), 404

    with SESSION_LOCK:
        user_data["active_id"] = analysis_id
    # created_at 保持不变，不更新

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


@app.route("/api/session/delete", methods=["POST"])
def api_session_delete():
    """删除指定分析会话"""
    data = request.get_json(force=True)
    analysis_id = (data.get("analysis_id") or "").strip()
    if not analysis_id:
        return jsonify({"error": "缺少 analysis_id"}), 400

    user_data = _get_user_data()
    with SESSION_LOCK:
        if analysis_id in user_data["analyses"]:
            del user_data["analyses"][analysis_id]
            _delete_analysis_from_disk(analysis_id)
        if user_data["active_id"] == analysis_id:
            remaining = sorted(user_data["analyses"].values(), key=lambda a: a["created_at"], reverse=True)
            user_data["active_id"] = remaining[0]["id"] if remaining else None

    return jsonify({"ok": True, "active_id": user_data.get("active_id")})


@app.route("/api/session/current", methods=["GET"])
def api_session_current():
    user_data = _get_user_data()
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


# ══════════════════════════════════════════════════════════════
#  设置
# ══════════════════════════════════════════════════════════════

SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")
DEFAULT_SETTINGS = {"theme": "dark", "accent": "green", "font_size": "large", "chart_engine": "matplotlib"}


def _mask_key(value):
    """遮蔽敏感 key，仅显示后 4 位"""
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return "****" + value[-4:]


def _load_ui_settings():
    """读取 UI 偏好设置文件"""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            return {**DEFAULT_SETTINGS, **saved}
    except Exception:
        pass
    return dict(DEFAULT_SETTINGS)


def _save_ui_settings(data):
    """保存 UI 偏好到 settings.json"""
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存设置失败: {e}")


def _write_env_value(key, value):
    """写入或更新 .env 中的某个 KEY=VALUE"""
    env_path = os.path.join(BASE_DIR, ".env")
    try:
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        else:
            lines = []
        found = False
        for i, line in enumerate(lines):
            if line.startswith(key + "=") or line.startswith(key + " "):
                lines[i] = f'{key}="{value}"\n'
                found = True
                break
        if not found:
            lines.append(f'{key}="{value}"\n')
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        # 同步更新 os.environ，确保 os.getenv() 也能读到新值
        os.environ[key] = value
        # 同步更新内存中的模块变量
        import core.config as cfg
        if key == "API_TOKEN":
            cfg.API_TOKEN = value
        elif key == "DEEPSEEK_API_KEY":
            cfg.DEEPSEEK_API_KEY = value
        elif key == "DEEPSEEK_MODEL":
            cfg.DEEPSEEK_MODEL = value
        elif key == "DEEPSEEK_CHAT_MODEL":
            cfg.DEEPSEEK_CHAT_MODEL = value
        elif key == "AI_TEMPERATURE":
            cfg.AI_TEMPERATURE = float(value)
        elif key == "CHAT_TEMPERATURE":
            cfg.CHAT_TEMPERATURE = float(value)
        elif key == "STEAM_COOKIE":
            cfg.STEAM_COOKIE = value
        return True
    except Exception as e:
        print(f"写入 .env 失败: {e}")
        return False


@app.route("/api/settings", methods=["GET"])
def api_settings_get():
    """获取当前设置（从模块属性读取，确保保存后即时反映）"""
    from core.config import API_TOKEN, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_CHAT_MODEL, AI_TEMPERATURE, CHAT_TEMPERATURE, STEAM_COOKIE
    token = API_TOKEN or ""
    dk = DEEPSEEK_API_KEY or ""
    model = DEEPSEEK_MODEL or "deepseek-v4-pro"
    chat_model = DEEPSEEK_CHAT_MODEL or "deepseek-v4-flash"
    ai_temp = str(AI_TEMPERATURE) if AI_TEMPERATURE else "0"
    steam_cookie = STEAM_COOKIE or ""
    chat_temp = str(CHAT_TEMPERATURE) if CHAT_TEMPERATURE else "0"
    ui = _load_ui_settings()
    return jsonify({
        "api_token_masked": token,
        "deepseek_key_masked": dk,
        "deepseek_model": model,
        "deepseek_chat_model": chat_model,
        "ai_temperature": ai_temp,
        "chat_temperature": chat_temp,
        "theme": ui.get("theme", "dark"),
        "accent": ui.get("accent", "green"),
        "font_size": ui.get("font_size", "normal"),
        "chart_engine": ui.get("chart_engine", "matplotlib"),
        "inv_sort": ui.get("inv_sort", {}),
        "steam_cookie_masked": "****" + steam_cookie[-8:] if len(steam_cookie) > 8 else (steam_cookie and "****"),
    })


@app.route("/api/settings", methods=["POST"])
def api_settings_save():
    """保存设置"""
    data = request.get_json(force=True)

    # API keys — only save if non-empty and not masked
    api_token = (data.get("api_token") or "").strip()
    deepseek_key = (data.get("deepseek_key") or "").strip()
    deepseek_model = (data.get("deepseek_model") or "").strip()
    deepseek_chat_model = (data.get("deepseek_chat_model") or "").strip()

    saved_any = False
    if api_token and not api_token.startswith("****"):
        if _write_env_value("API_TOKEN", api_token):
            saved_any = True
    if deepseek_key and not deepseek_key.startswith("****"):
        if _write_env_value("DEEPSEEK_API_KEY", deepseek_key):
            saved_any = True
    if deepseek_model:
        if _write_env_value("DEEPSEEK_MODEL", deepseek_model):
            saved_any = True
    if deepseek_chat_model:
        if _write_env_value("DEEPSEEK_CHAT_MODEL", deepseek_chat_model):
            saved_any = True

    # AI model params
    ai_temp = (data.get("ai_temperature") or "").strip()
    chat_temp = (data.get("chat_temperature") or "").strip()
    if ai_temp:
        if _write_env_value("AI_TEMPERATURE", ai_temp):
            saved_any = True
    if chat_temp:
        if _write_env_value("CHAT_TEMPERATURE", chat_temp):
            saved_any = True

    # Steam cookie (可以置空来清除)
    steam_cookie = (data.get("steam_cookie") or "").strip()
    if steam_cookie != "****":
        if _write_env_value("STEAM_COOKIE", steam_cookie):
            saved_any = True

    # UI preferences
    ui = {
        "theme": data.get("theme", "dark"),
        "accent": data.get("accent", "green"),
        "font_size": data.get("font_size", "normal"),
        "chart_engine": data.get("chart_engine", "matplotlib"),
    }
    _save_ui_settings(ui)
    saved_any = True

    return jsonify({"ok": True, "saved": saved_any})


@app.route("/api/settings/inventory-sort", methods=["POST"])
def api_inventory_sort_save():
    """保存库存列表排序偏好"""
    data = request.get_json(force=True)
    ui = _load_ui_settings()
    ui["inv_sort"] = {
        "key": data.get("key", ""),
        "asc": data.get("asc", True),
        "mode": data.get("mode", "pct"),
    }
    _save_ui_settings(ui)
    return jsonify({"ok": True})


@app.route("/api/settings/my-ip", methods=["GET"])
def api_settings_my_ip():
    """获取当前客户端 IP（本地 + 公网）"""
    import requests as req_lib
    result = {
        "local_ip": request.remote_addr or "未知",
    }
    # 尝试多个公网 IP 查询服务（国内可用优先）
    ip_services = [
        ("https://myip.ipip.net", "text"),       # 国内，纯文本 "当前 IP：x.x.x.x  来自于：..."
        ("https://api.ip.sb/ip", "text"),         # 纯文本返回 IP
        ("https://ifconfig.me/ip", "text"),       # 纯文本返回 IP
        ("https://api.ipify.org?format=json", "json"),  # JSON
    ]
    for url, fmt in ip_services:
        try:
            r = req_lib.get(url, timeout=6, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code == 200:
                if fmt == "json":
                    data = r.json()
                    ip = data.get("ip", "")
                else:
                    text = r.text.strip()
                    # ipip.net 返回 "当前 IP：x.x.x.x  来自于：..." 格式
                    if "当前 IP" in text or "IP：" in text:
                        import re
                        m = re.search(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', text)
                        ip = m.group(1) if m else ""
                    else:
                        ip = text
                if ip:
                    result["public_ip"] = ip
                    break
        except Exception:
            continue
    if "public_ip" not in result:
        result["public_ip"] = "获取失败"
    return jsonify(result)


@app.route("/api/settings/bind-ip", methods=["POST"])
def api_settings_bind_ip():
    """绑定 IP 白名单到 csqaq API"""
    import http.client
    from core.config import API_TOKEN

    if not API_TOKEN:
        return jsonify({"code": -1, "msg": "未配置 API Token，请先在设置中填写"}), 400

    try:
        conn = http.client.HTTPSConnection("api.csqaq.com", timeout=15)
        headers = {"ApiToken": API_TOKEN}
        conn.request("POST", "/api/v1/sys/bind_local_ip", "", headers)
        res = conn.getresponse()
        data = res.read().decode("utf-8")
        conn.close()

        result = json.loads(data)
        return jsonify({
            "code": result.get("code", -1),
            "data": result.get("data", ""),
            "msg": result.get("msg", ""),
        })
    except Exception as e:
        return jsonify({"code": -1, "msg": f"绑定请求失败: {str(e)}"}), 500


# ═══════════════════ ID 映射文件上传 ═══════════════════

@app.route("/api/settings/id-map/info", methods=["GET"])
def api_id_map_info():
    """返回当前 ID 映射文件的元信息"""
    import os
    file_path = ID_MAP_FILE
    info = {
        "exists": os.path.exists(file_path),
        "filename": os.path.basename(file_path),
        "item_count": len(id_to_name),
    }
    if info["exists"]:
        stat = os.stat(file_path)
        info["size_kb"] = round(stat.st_size / 1024, 1)
        info["updated_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
    return jsonify(info)


@app.route("/api/settings/id-map/preview", methods=["GET"])
def api_id_map_preview():
    """返回 ID 映射文件的前 N 条预览数据"""
    import os
    limit = request.args.get("limit", 20, type=int)
    offset = request.args.get("offset", 0, type=int)
    file_path = ID_MAP_FILE

    if not os.path.exists(file_path):
        return jsonify({"error": "映射文件不存在"}), 404

    try:
        with open(file_path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except Exception as e:
        return jsonify({"error": f"读取文件失败: {str(e)}"}), 500

    total = len(data) if isinstance(data, list) else 0
    chunk = data[offset:offset + limit] if isinstance(data, list) else []

    return jsonify({
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": chunk,
    })


@app.route("/api/settings/id-map/search", methods=["GET"])
def api_id_map_search():
    """在 ID 映射中模糊搜索饰品"""
    import os
    q = (request.args.get("q") or "").strip()
    limit = request.args.get("limit", 30, type=int)
    offset = request.args.get("offset", 0, type=int)
    file_path = ID_MAP_FILE

    if not q or len(q) < 1:
        return jsonify({"total": 0, "offset": 0, "limit": limit, "items": [], "query": q})

    if not os.path.exists(file_path):
        return jsonify({"error": "映射文件不存在"}), 404

    try:
        with open(file_path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except Exception as e:
        return jsonify({"error": f"读取文件失败: {str(e)}"}), 500

    if not isinstance(data, list):
        return jsonify({"error": "数据格式错误"}), 500

    q_lower = q.lower()

    # 优先级匹配：ID 精确 → 中文名子串 → 市场名子串
    matched = []
    for item in data:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id", ""))
        name = item.get("name", "") or ""
        mkt = item.get("market_hash_name", "") or ""

        if sid == q:  # ID 精确匹配排最前
            matched.insert(0, item)
        elif q_lower in name.lower() or q_lower in mkt.lower():
            matched.append(item)

    total = len(matched)
    chunk = matched[offset:offset + limit]

    return jsonify({
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": chunk,
        "query": q,
    })


@app.route("/api/settings/id-map/upload", methods=["POST"])
def api_id_map_upload():
    """上传并替换饰品 ID 映射 JSON 文件"""
    global name_to_id, market_to_id, id_to_name

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "未选择文件"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".json"):
        return jsonify({"ok": False, "error": "仅支持 .json 文件"}), 400

    # 读取并验证 JSON 结构
    try:
        raw = file.read()
        data = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return jsonify({"ok": False, "error": f"JSON 解析失败: {str(e)}"}), 400

    if not isinstance(data, list) or len(data) == 0:
        return jsonify({"ok": False, "error": "JSON 格式错误: 需要非空数组"}), 400

    # 验证每个元素包含必需字段
    valid = 0
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            return jsonify({"ok": False, "error": f"第 {i+1} 项不是对象"}), 400
        if "id" not in item or "name" not in item:
            return jsonify({"ok": False, "error": f"第 {i+1} 项缺少 'id' 或 'name' 字段"}), 400
        valid += 1

    # 备份旧文件
    old_path = ID_MAP_FILE
    backup_path = old_path + ".bak"
    try:
        if os.path.exists(old_path):
            if os.path.exists(backup_path):
                os.remove(backup_path)
            os.rename(old_path, backup_path)
    except OSError as e:
        return jsonify({"ok": False, "error": f"备份旧文件失败: {str(e)}"}), 500

    # 写入新文件
    try:
        os.makedirs(os.path.dirname(old_path), exist_ok=True)
        with open(old_path, "wb") as f:
            f.write(raw)
    except OSError as e:
        # 尝试恢复备份
        if os.path.exists(backup_path):
            os.rename(backup_path, old_path)
        return jsonify({"ok": False, "error": f"写入文件失败: {str(e)}"}), 500

    # 重建内存映射
    try:
        new_name_to_id, new_market_to_id, new_id_to_name = load_id_map(old_path)
        if not new_id_to_name:
            raise ValueError("映射为空，回滚")
    except Exception as e:
        # 回滚：恢复旧文件
        if os.path.exists(backup_path):
            os.rename(backup_path, old_path)
        return jsonify({"ok": False, "error": f"加载新映射失败，已回滚: {str(e)}"}), 500

    name_to_id = new_name_to_id
    market_to_id = new_market_to_id
    id_to_name = new_id_to_name

    # 清理备份
    if os.path.exists(backup_path):
        os.remove(backup_path)

    print(f"ID 映射已更新: {len(id_to_name)} 个饰品 (上传 {valid} 条记录)")
    return jsonify({
        "ok": True,
        "item_count": len(id_to_name),
        "valid_entries": valid,
        "filename": file.filename,
    })


# ═══════════════════ 知识库 ═══════════════════

KB_FILE = os.path.join(BASE_DIR, "knowledge_base.json")


def _load_kb():
    if not os.path.exists(KB_FILE):
        return []
    try:
        with open(KB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_kb(kb):
    with open(KB_FILE, "w", encoding="utf-8") as f:
        json.dump(kb, f, ensure_ascii=False, indent=2)


def match_knowledge(item_name, kb_entries):
    """从知识库匹配与饰品相关的条目"""
    import re
    keywords = set()
    clean = re.sub(r'[（(][^)）]*[)）]', '', item_name)
    clean = re.sub(r'[★\s]', '', clean)
    for part in clean.split("|"):
        part = part.strip()
        if len(part) >= 2:
            keywords.add(part.lower())

    scored = []
    for entry in kb_entries:
        score = 0
        text = (entry.get("title", "") + " " + entry.get("content", "") +
                " " + " ".join(entry.get("tags", []))).lower()
        for kw in keywords:
            if kw in text:
                score += 1
        if score > 0:
            scored.append((score, entry))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored]


@app.route("/api/knowledge", methods=["GET"])
def api_knowledge_list():
    q = (request.args.get("q") or "").strip().lower()
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", type=int, default=0)
    kb = _load_kb()
    if q:
        kb = [e for e in kb if q in e.get("title", "").lower()
              or q in e.get("content", "").lower()
              or any(q in t.lower() for t in e.get("tags", []))]
    def _kb_sort_key(e):
        ed = e.get("event_date")
        if ed:
            try:
                return time.mktime(time.strptime(ed, "%Y-%m-%d"))
            except Exception:
                pass
        return e.get("updated_at", e.get("created_at", 0))
    kb.sort(key=_kb_sort_key, reverse=True)
    total = len(kb)
    if limit:
        kb = kb[offset:offset + limit]
    return jsonify({"items": kb, "total": total})


@app.route("/api/knowledge", methods=["POST"])
def api_knowledge_add():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify({"error": "标题和内容不能为空"}), 400
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    now = time.time()
    event_date = (data.get("event_date") or "").strip() or None
    entry = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "content": content,
        "tags": tags,
        "event_date": event_date,
        "created_at": now,
        "updated_at": now,
    }
    kb = _load_kb()
    kb.append(entry)
    _save_kb(kb)
    return jsonify(entry)


@app.route("/api/knowledge/<entry_id>", methods=["PUT"])
def api_knowledge_update(entry_id):
    data = request.get_json(force=True)
    kb = _load_kb()
    entry = next((e for e in kb if e.get("id") == entry_id), None)
    if not entry:
        return jsonify({"error": "条目不存在"}), 404
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify({"error": "标题和内容不能为空"}), 400
    entry["title"] = title
    entry["content"] = content
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    entry["tags"] = tags
    event_date = (data.get("event_date") or "").strip() or None
    if event_date is not None:
        entry["event_date"] = event_date
    elif "event_date" in data and not data["event_date"]:
        entry.pop("event_date", None)
    entry["updated_at"] = time.time()
    _save_kb(kb)
    return jsonify(entry)


@app.route("/api/knowledge/<entry_id>", methods=["DELETE"])
def api_knowledge_delete(entry_id):
    kb = _load_kb()
    kb = [e for e in kb if e.get("id") != entry_id]
    _save_kb(kb)
    return jsonify({"ok": True})


# ═══════════════════ 提示词管理 ═══════════════════

@app.route("/api/prompts", methods=["GET"])
def api_prompts_get():
    """获取所有提示词数据"""
    return jsonify(prompt_mgr.get_all())


@app.route("/api/prompts/<key>/active", methods=["PUT"])
def api_prompts_set_active(key):
    """切换当前使用的模板"""
    data = request.get_json(force=True)
    tid = (data.get("id") or "").strip()
    if not tid:
        return jsonify({"error": "缺少模板 id"}), 400
    ok = prompt_mgr.set_active(key, tid)
    if not ok:
        return jsonify({"error": "模板不存在"}), 404
    return jsonify({"ok": True})


@app.route("/api/prompts/<key>/templates", methods=["POST"])
def api_prompts_add_template(key):
    """新建自定义模板"""
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    text = (data.get("text") or "").strip()
    if not name or not text:
        return jsonify({"error": "名称和内容不能为空"}), 400
    tid = prompt_mgr.add_template(key, name, text)
    if tid is None:
        return jsonify({"error": "未知的提示词 key"}), 404
    return jsonify({"id": tid, "name": name})


@app.route("/api/prompts/<key>/templates/<tid>", methods=["PUT"])
def api_prompts_update_template(key, tid):
    """更新模板名称/内容"""
    data = request.get_json(force=True)
    name = data.get("name", "").strip() or None
    text = data.get("text", "").strip() or None
    ok = prompt_mgr.update_template(key, tid, name=name, text=text)
    if not ok:
        return jsonify({"error": "模板不存在或为内置模板，无法修改"}), 400
    return jsonify({"ok": True})


@app.route("/api/prompts/<key>/templates/<tid>", methods=["DELETE"])
def api_prompts_delete_template(key, tid):
    """删除自定义模板"""
    ok = prompt_mgr.delete_template(key, tid)
    if not ok:
        return jsonify({"error": "无法删除（不存在或为内置模板）"}), 400
    return jsonify({"ok": True})

# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import webbrowser
    host, port = "127.0.0.1", 5000

    print(f"\n{'='*50}")
    print(f"  CS2 饰品价格分析桌面应用 v2.0")
    print(f"  http://{host}:{port}")
    print(f"{'='*50}\n")

    threading.Timer(1.0, lambda: webbrowser.open(f"http://{host}:{port}")).start()
    app.run(host=host, port=port, debug=False)
