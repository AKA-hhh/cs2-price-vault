# -*- coding: utf-8 -*-
"""设置 + ID 映射管理 API"""

import os
import json
import re
from datetime import datetime
from flask import Blueprint, request, jsonify
import shared

settings_bp = Blueprint("settings", __name__)


# ═══════════════════ 设置 ═══════════════════

@settings_bp.route("/api/settings", methods=["GET"])
def api_settings_get():
    from core.config import API_TOKEN, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_CHAT_MODEL, AI_TEMPERATURE, CHAT_TEMPERATURE, STEAM_COOKIE
    token = API_TOKEN or ""
    dk = DEEPSEEK_API_KEY or ""
    model = DEEPSEEK_MODEL or "deepseek-v4-pro"
    chat_model = DEEPSEEK_CHAT_MODEL or "deepseek-v4-flash"
    ai_temp = str(AI_TEMPERATURE) if AI_TEMPERATURE else "0"
    steam_cookie = STEAM_COOKIE or ""
    chat_temp = str(CHAT_TEMPERATURE) if CHAT_TEMPERATURE else "0"
    ui = shared._load_ui_settings()
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


@settings_bp.route("/api/settings", methods=["POST"])
def api_settings_save():
    data = request.get_json(force=True)

    api_token = (data.get("api_token") or "").strip()
    deepseek_key = (data.get("deepseek_key") or "").strip()
    deepseek_model = (data.get("deepseek_model") or "").strip()
    deepseek_chat_model = (data.get("deepseek_chat_model") or "").strip()

    saved_any = False
    if api_token and not api_token.startswith("****"):
        if shared._write_env_value("API_TOKEN", api_token):
            saved_any = True
    if deepseek_key and not deepseek_key.startswith("****"):
        if shared._write_env_value("DEEPSEEK_API_KEY", deepseek_key):
            saved_any = True
    if deepseek_model:
        if shared._write_env_value("DEEPSEEK_MODEL", deepseek_model):
            saved_any = True
    if deepseek_chat_model:
        if shared._write_env_value("DEEPSEEK_CHAT_MODEL", deepseek_chat_model):
            saved_any = True

    ai_temp = (data.get("ai_temperature") or "").strip()
    chat_temp = (data.get("chat_temperature") or "").strip()
    if ai_temp:
        if shared._write_env_value("AI_TEMPERATURE", ai_temp):
            saved_any = True
    if chat_temp:
        if shared._write_env_value("CHAT_TEMPERATURE", chat_temp):
            saved_any = True

    steam_cookie = (data.get("steam_cookie") or "").strip()
    if steam_cookie != "****":
        if shared._write_env_value("STEAM_COOKIE", steam_cookie):
            saved_any = True

    ui = {
        "theme": data.get("theme", "dark"),
        "accent": data.get("accent", "green"),
        "font_size": data.get("font_size", "normal"),
        "chart_engine": data.get("chart_engine", "matplotlib"),
    }
    shared._save_ui_settings(ui)
    saved_any = True

    return jsonify({"ok": True, "saved": saved_any})


@settings_bp.route("/api/settings/inventory-sort", methods=["POST"])
def api_inventory_sort_save():
    data = request.get_json(force=True)
    ui = shared._load_ui_settings()
    ui["inv_sort"] = {
        "key": data.get("key", ""),
        "asc": data.get("asc", True),
        "mode": data.get("mode", "pct"),
    }
    shared._save_ui_settings(ui)
    return jsonify({"ok": True})


@settings_bp.route("/api/settings/my-ip", methods=["GET"])
def api_settings_my_ip():
    import requests as req_lib
    result = {"local_ip": request.remote_addr or "未知"}

    ip_services = [
        ("https://myip.ipip.net", "text"),
        ("https://api.ip.sb/ip", "text"),
        ("https://ifconfig.me/ip", "text"),
        ("https://api.ipify.org?format=json", "json"),
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
                    if "当前 IP" in text or "IP：" in text:
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


@settings_bp.route("/api/settings/bind-ip", methods=["POST"])
def api_settings_bind_ip():
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


# ═══════════════════ ID 映射管理 ═══════════════════

from core.config import ID_MAP_FILE


@settings_bp.route("/api/settings/id-map/info", methods=["GET"])
def api_id_map_info():
    file_path = ID_MAP_FILE
    info = {
        "exists": os.path.exists(file_path),
        "filename": os.path.basename(file_path),
        "item_count": len(shared.id_to_name),
    }
    if info["exists"]:
        stat = os.stat(file_path)
        info["size_kb"] = round(stat.st_size / 1024, 1)
        info["updated_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
    return jsonify(info)


@settings_bp.route("/api/settings/id-map/preview", methods=["GET"])
def api_id_map_preview():
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


@settings_bp.route("/api/settings/id-map/search", methods=["GET"])
def api_id_map_search():
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
    matched = []
    for item in data:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id", ""))
        name = item.get("name", "") or ""
        mkt = item.get("market_hash_name", "") or ""

        if sid == q:
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


@settings_bp.route("/api/settings/id-map/upload", methods=["POST"])
def api_id_map_upload():
    from core.id_map import load_id_map

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "未选择文件"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".json"):
        return jsonify({"ok": False, "error": "仅支持 .json 文件"}), 400

    try:
        raw = file.read()
        data = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return jsonify({"ok": False, "error": f"JSON 解析失败: {str(e)}"}), 400

    if not isinstance(data, list) or len(data) == 0:
        return jsonify({"ok": False, "error": "JSON 格式错误: 需要非空数组"}), 400

    valid = 0
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            return jsonify({"ok": False, "error": f"第 {i+1} 项不是对象"}), 400
        if "id" not in item or "name" not in item:
            return jsonify({"ok": False, "error": f"第 {i+1} 项缺少 'id' 或 'name' 字段"}), 400
        valid += 1

    old_path = ID_MAP_FILE
    backup_path = old_path + ".bak"
    try:
        if os.path.exists(old_path):
            if os.path.exists(backup_path):
                os.remove(backup_path)
            os.rename(old_path, backup_path)
    except OSError as e:
        return jsonify({"ok": False, "error": f"备份旧文件失败: {str(e)}"}), 500

    try:
        os.makedirs(os.path.dirname(old_path), exist_ok=True)
        with open(old_path, "wb") as f:
            f.write(raw)
    except OSError as e:
        if os.path.exists(backup_path):
            os.rename(backup_path, old_path)
        return jsonify({"ok": False, "error": f"写入文件失败: {str(e)}"}), 500

    try:
        new_name_to_id, new_market_to_id, new_id_to_name = load_id_map(old_path)
        if not new_id_to_name:
            raise ValueError("映射为空，回滚")
    except Exception as e:
        if os.path.exists(backup_path):
            os.rename(backup_path, old_path)
        return jsonify({"ok": False, "error": f"加载新映射失败，已回滚: {str(e)}"}), 500

    shared.name_to_id = new_name_to_id
    shared.market_to_id = new_market_to_id
    shared.id_to_name = new_id_to_name

    if os.path.exists(backup_path):
        os.remove(backup_path)

    print(f"ID 映射已更新: {len(shared.id_to_name)} 个饰品 (上传 {valid} 条记录)")
    return jsonify({
        "ok": True,
        "item_count": len(shared.id_to_name),
        "valid_entries": valid,
        "filename": file.filename,
    })
