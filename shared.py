# -*- coding: utf-8 -*-
"""共享状态 + 跨模块辅助函数

所有蓝图通过 import shared 访问可变状态，禁止 from shared import xxx
（后者会捕获导入时的引用，看不到后续变更）。
"""

import os
import io
import json
import time
import base64
import threading
from datetime import datetime

# ── 文件路径常量 ──
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HISTORY_DIR = os.path.join(BASE_DIR, "history")
WATCHLIST_FILE = os.path.join(BASE_DIR, "watchlist.json")
PORTFOLIO_FILE = os.path.join(BASE_DIR, "portfolio.json")
KB_FILE = os.path.join(BASE_DIR, "knowledge_base.json")
SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")
INVENTORY_CACHE_FILE = os.path.join(BASE_DIR, "inventory.json")

os.makedirs(HISTORY_DIR, exist_ok=True)

# ── 常量 ──
INVENTORY_CACHE_TTL = 300  # 库存缓存有效期 (秒)
MAX_ANALYSES_PER_USER = 50
DEFAULT_SETTINGS = {"theme": "dark", "accent": "green", "font_size": "large", "chart_engine": "matplotlib"}
_DEFAULT_USER = "_local_"

# ═══════════════════ 可变状态 ═══════════════════

# ID 映射 (启动时加载，运行时可通过 id-map 上传替换)
name_to_id = {}
market_to_id = {}
id_to_name = {}

# 库存缓存 (SteamID64 → {data, timestamp, sparklines?, sparklines_ts?})
_inventory_cache = {}

# 分析会话 (桌面单用户)
user_sessions = {}
SESSION_LOCK = threading.Lock()


# ═══════════════════ 初始化 ═══════════════════

def init_shared_state():
    """启动时加载持久化状态到内存 (由 app.py 调用)"""
    global name_to_id, market_to_id, id_to_name, _inventory_cache, user_sessions

    from core.config import ID_MAP_FILE
    from core.id_map import load_id_map

    print("正在加载饰品ID映射...")
    name_to_id, market_to_id, id_to_name = load_id_map(ID_MAP_FILE)
    print(f"已加载 {len(id_to_name)} 条饰品映射，服务就绪。")

    # 恢复库存缓存
    _inventory_cache = _load_inventory_file()
    if _inventory_cache:
        print(f"已恢复 {len(_inventory_cache)} 条库存缓存")

    # 恢复分析历史
    disk_analyses, disk_active = _load_analyses_from_disk()
    user_sessions[_DEFAULT_USER] = {
        "active_id": disk_active,
        "analyses": disk_analyses,
    }


# ═══════════════════ 通用辅助 ═══════════════════

def _get_user_data():
    """获取本地默认用户的数据容器"""
    return user_sessions[_DEFAULT_USER]


def _mask_key(value):
    """遮蔽敏感 key，仅显示后 4 位"""
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return "****" + value[-4:]


# ═══════════════════ 库存持久化 ═══════════════════

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
        if entry.get("sparklines"):
            slim[sid]["sparklines"] = entry["sparklines"]
            slim[sid]["sparklines_ts"] = entry.get("sparklines_ts", 0)
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


# ═══════════════════ 自选持久化 ═══════════════════

def _load_watchlist():
    if not os.path.exists(WATCHLIST_FILE):
        return []
    try:
        with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_watchlist(wl):
    with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
        json.dump(wl, f, ensure_ascii=False, indent=2)


# ═══════════════════ 持仓持久化 ═══════════════════

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


# ═══════════════════ 知识库持久化 ═══════════════════

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


# ═══════════════════ 分析历史磁盘操作 ═══════════════════

def _analysis_disk_path(aid):
    return (
        os.path.join(HISTORY_DIR, f"{aid}.json"),
        os.path.join(HISTORY_DIR, f"{aid}.png"),
        os.path.join(HISTORY_DIR, f"{aid}_chart.html"),
    )


def _save_analysis_to_disk(analysis):
    aid = analysis["id"]
    json_path, png_path, html_path = _analysis_disk_path(aid)
    try:
        if analysis.get("chart_b64"):
            img_data = base64.b64decode(analysis["chart_b64"])
            with open(png_path, "wb") as f:
                f.write(img_data)
        if analysis.get("chart_html"):
            try:
                with open(html_path, "w", encoding="utf-8") as f:
                    f.write(analysis["chart_html"])
            except Exception as e:
                print(f"  保存图表 HTML 失败 [{aid}]: {e}")
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
    json_path, png_path, html_path = _analysis_disk_path(aid)
    for p in (json_path, png_path, html_path):
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


def _load_analyses_from_disk():
    restored = {}
    try:
        for fname in os.listdir(HISTORY_DIR):
            if not fname.endswith(".json"):
                continue
            aid = fname[:-5]
            json_path, png_path, html_path = _analysis_disk_path(aid)
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    record = json.load(f)
            except Exception:
                continue
            chart_b64 = ""
            if os.path.exists(png_path):
                try:
                    with open(png_path, "rb") as f:
                        chart_b64 = base64.b64encode(f.read()).decode("utf-8")
                except Exception:
                    pass
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

    sorted_items = sorted(restored.values(), key=lambda a: a["created_at"], reverse=True)
    print(f"从磁盘恢复 {len(sorted_items)} 条分析历史")
    return restored, sorted_items[0]["id"] if sorted_items else None


def _analysis_to_summary(a):
    rec = a.get("recommendation", {})
    ts = a.get("created_at", 0)
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


# ═══════════════════ 图表辅助 ═══════════════════

def _fig_to_base64(fig=None):
    import matplotlib.pyplot as plt
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
    try:
        img_bytes = fig.to_image(format="png", scale=2)
        return base64.b64encode(img_bytes).decode("utf-8")
    except ValueError as e:
        print(f"Plotly PNG 导出失败 (需安装 kaleido): {e}")
        return None


def _build_chart_html_page(fig):
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
    from core.prompts import prompt_mgr
    prompt = _build_ai_prompt(df, item_name, period_days, recommendation)
    return [
        {"role": "system", "content": prompt_mgr.get("chat_system")},
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": ai_text},
    ]


# ═══════════════════ 设置持久化 ═══════════════════

def _load_ui_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            return {**DEFAULT_SETTINGS, **saved}
    except Exception:
        pass
    return dict(DEFAULT_SETTINGS)


def _save_ui_settings(data):
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
        os.environ[key] = value
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
