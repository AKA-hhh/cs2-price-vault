# -*- coding: utf-8 -*-
"""Steam CS2 库存 API — 拉取库存、SteamID 解析、价格查询"""

import re
import json
import time
import requests
from . import config  # 通过 config.XXX 引用，确保 _write_env_value 更新后读取最新值

# ── 代理配置 ──
def _get_proxies():
    """获取 Steam 请求代理（中国大陆需要）"""
    if config.STEAM_PROXY:
        return {"http": config.STEAM_PROXY, "https": config.STEAM_PROXY}
    return None

# 中英文磨损等级映射
_WEAR_MAP = {
    "Factory New": "崭新出厂",
    "Minimal Wear": "略有磨损",
    "Field-Tested": "久经沙场",
    "Well-Worn": "破损不堪",
    "Battle-Scarred": "战痕累累",
}

# 品质中文映射
_QUALITY_MAP = {
    "Normal": "普通",
    "StatTrak": "StatTrak™",
    "Souvenir": "纪念品",
    "Unusual": "不同寻常",
}

# 稀有度/颜色中英文映射
_RARITY_COLORS = {
    "Consumer Grade": ("消费级", "#b0c3d9"),
    "Industrial Grade": ("工业级", "#5e98d9"),
    "Mil-Spec Grade": ("军规级", "#4b69ff"),
    "Restricted": ("受限", "#8847ff"),
    "Classified": ("保密", "#d32ce6"),
    "Covert": ("隐秘", "#eb4b4b"),
    "Rare Special Item": ("稀有特殊物品", "#ffd700"),
    "Contraband": ("违禁品", "#ffd700"),
    "Base Grade": ("基础级", "#b0c3d9"),
    "Extraordinary": ("非凡", "#eb4b4b"),
}


def parse_steam_id(raw):
    """解析多种 Steam ID 格式，返回 (steamid64: str, error: str|None)

    支持格式:
      - SteamID64:  7656119xxxxxxxxxx (17位数字)
      - SteamID:    STEAM_0:1:12345678
      - SteamID3:   [U:1:12345678]
      - 自定义URL:  steamcommunity.com/id/xxx
      - 资料页URL:  steamcommunity.com/profiles/7656119xxx
      - 纯自定义ID: xxx (假设是自定义 URL 的 id 部分)
    """
    raw = raw.strip()

    if not raw:
        return None, "请输入 Steam ID"

    # 1) 已经是 SteamID64 (17位数字，以 7656 开头)
    if re.match(r'^7656\d{13}$', raw):
        return raw, None

    # 2) SteamID 格式: STEAM_0:1:12345678
    m = re.match(r'^STEAM_[0-5]:[01]:(\d+)$', raw, re.IGNORECASE)
    if m:
        account_id = int(m.group(1))
        steamid64 = str(account_id * 2 + 76561197960265728 + int(raw.split(':')[1]))
        return steamid64, None

    # 3) SteamID3 格式: [U:1:12345678]
    m = re.match(r'^\[U:1:(\d+)\]$', raw, re.IGNORECASE)
    if m:
        account_id = int(m.group(1))
        steamid64 = str(account_id + 76561197960265728)
        return steamid64, None

    # 4) 完整资料页 URL: steamcommunity.com/profiles/7656119xxx
    m = re.search(r'steamcommunity\.com/profiles/(\d{17})', raw, re.IGNORECASE)
    if m:
        return m.group(1), None

    # 5) 自定义 URL: steamcommunity.com/id/xxx
    m = re.search(r'steamcommunity\.com/id/([^\s/]+)', raw, re.IGNORECASE)
    if m:
        custom_id = m.group(1)
        return _resolve_custom_url(custom_id)

    # 6) 纯自定义 ID（无 URL 前缀），尝试解析
    if re.match(r'^[a-zA-Z0-9_-]{3,32}$', raw):
        return _resolve_custom_url(raw)

    return None, f"无法识别的 Steam ID 格式: {raw}"


def _resolve_custom_url(custom_id):
    """通过 Steam XML 页面解析自定义 URL → SteamID64"""
    url = f"https://steamcommunity.com/id/{custom_id}?xml=1"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    try:
        time.sleep(config.STEAM_REQUEST_DELAY)
        resp = requests.get(url, headers=headers, timeout=config.STEAM_INVENTORY_TIMEOUT, proxies=_get_proxies())
        if resp.status_code != 200:
            return None, f"Steam 个人资料请求失败 (HTTP {resp.status_code})，请确认 ID 有效且库存已设为公开"
        # XML 中 <steamID64>7656119xxx</steamID64>
        m = re.search(r'<steamID64>(\d{17})</steamID64>', resp.text)
        if m:
            return m.group(1), None
        # 如果找不到 steamID64，可能是私有资料或无此用户
        if "The specified profile could not be found" in resp.text:
            return None, f"未找到 Steam 用户: {custom_id}"
        return None, f"无法解析 Steam 用户: {custom_id} (请尝试直接输入 17 位 SteamID64)"
    except requests.exceptions.Timeout:
        return None, "Steam 请求超时，请稍后重试"
    except Exception as e:
        return None, f"Steam 请求异常: {e}"


def get_steam_inventory(steamid64):
    """拉取 Steam CS2 公开库存（分页获取全部物品）

    Args:
        steamid64: 17位 SteamID64

    Returns:
        dict: {"success": bool, "items": list, "total_count": int, "error": str|None}
    """
    url = f"https://steamcommunity.com/inventory/{steamid64}/730/2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    if config.STEAM_COOKIE:
        headers["Cookie"] = f"steamLoginSecure={config.STEAM_COOKIE}"

    all_assets = []
    all_descriptions = {}
    total_count = 0
    start_assetid = None
    page = 0
    max_pages = 10  # 安全上限

    try:
        while page < max_pages:
            page += 1
            params = {"l": "english", "count": 2000}
            if start_assetid:
                params["start_assetid"] = start_assetid

            if page > 1:
                time.sleep(config.STEAM_REQUEST_DELAY)

            resp = requests.get(url, params=params, headers=headers, timeout=config.STEAM_INVENTORY_TIMEOUT, proxies=_get_proxies())

            if resp.status_code == 429:
                if page == 1:
                    return {"success": False, "items": [], "total_count": 0,
                            "error": "Steam API 请求过于频繁 (429)，请等待 1-2 分钟后再试"}
                print(f"  [库存] 429 限流于第 {page} 页，停止分页")
                break
            if resp.status_code == 403:
                return {"success": False, "items": [], "total_count": 0,
                        "error": "无法访问该库存 (403)，请确认 Steam 个人资料的库存隐私已设为「公开」"}
            if resp.status_code != 200:
                if page == 1:
                    return {"success": False, "items": [], "total_count": 0,
                            "error": f"Steam API 返回 HTTP {resp.status_code}"}
                print(f"  [库存] HTTP {resp.status_code} 于第 {page} 页，停止分页")
                break

            data = resp.json()

            if not data.get("success"):
                if data.get("error"):
                    return {"success": False, "items": [], "total_count": 0,
                            "error": f"Steam 返回错误: {data.get('error')}"}
                # 空库存 — 不算错误
                return {"success": True, "items": [], "total_count": 0, "error": None}

            assets = data.get("assets", [])
            descriptions = data.get("descriptions", [])
            total_count = data.get("total_inventory_count", total_count)

            all_assets.extend(assets)
            for d in descriptions:
                cid = str(d.get("classid", ""))
                iid = str(d.get("instanceid", ""))
                key = f"{cid}_{iid}"
                if key not in all_descriptions:
                    all_descriptions[key] = d

            # 检查是否还有更多页
            last_assetid = data.get("last_assetid")
            if not last_assetid or len(assets) < 2000:
                break
            start_assetid = last_assetid

    except requests.exceptions.Timeout:
        if page == 1:
            return {"success": False, "items": [], "total_count": 0,
                    "error": "Steam API 请求超时，请稍后重试"}
    except requests.exceptions.JSONDecodeError:
        if page == 1:
            return {"success": False, "items": [], "total_count": 0,
                    "error": "Steam 返回数据格式异常（可能库存为空或 SteamID 不存在）"}
    except Exception as e:
        if page == 1:
            return {"success": False, "items": [], "total_count": 0,
                    "error": f"Steam API 请求异常: {e}"}

    if not all_descriptions:
        return {"success": True, "items": [], "total_count": total_count, "error": None}

    # 构建 description 索引（三级：精确匹配 → classid 回退 → 全局名称回退）
    desc_index = {}       # classid_instanceid → description
    class_desc_map = {}   # classid → [descriptions]
    name_desc_map = {}    # market_hash_name → description (最后兜底)
    for key, d in all_descriptions.items():
        desc_index[key] = d
        cid = str(d.get("classid", ""))
        class_desc_map.setdefault(cid, []).append(d)
        mhn = d.get("market_hash_name", "")
        if mhn and mhn not in name_desc_map:
            name_desc_map[mhn] = d

    # 解析物品
    items = []
    skipped = 0
    unmatched_details = []  # 收集未匹配详情用于诊断
    for asset in all_assets:
        classid = str(asset.get("classid", ""))
        instanceid = str(asset.get("instanceid", ""))
        key = f"{classid}_{instanceid}"
        desc = desc_index.get(key)
        # 精确匹配失败，回退用 classid 匹配
        if not desc:
            candidates = class_desc_map.get(classid, [])
            if candidates:
                desc = candidates[0]
        if not desc:
            # 最后尝试：从已匹配物品中按名称推断
            # （某些物品 classid 不在任何 description 中，但名称与其他已匹配物品相同）
            unmatched_details.append({
                "classid": classid,
                "instanceid": instanceid,
                "assetid": asset.get("assetid", ""),
                "amount": asset.get("amount", "1"),
            })
            skipped += 1
            continue

        # 解析 tags
        tags = {}
        for t in desc.get("tags", []):
            tags[t.get("category", "")] = t.get("localized_tag_name", "")

        weapon = tags.get("Weapon", "")
        exterior_raw = tags.get("Exterior", "")
        quality_raw = tags.get("Quality", "Normal")
        rarity_raw = tags.get("Rarity", "")
        item_type = tags.get("Type", "")

        exterior = _WEAR_MAP.get(exterior_raw, exterior_raw)
        quality = _QUALITY_MAP.get(quality_raw, quality_raw)
        rarity_cn, rarity_color = _RARITY_COLORS.get(rarity_raw, (rarity_raw, "#888"))

        # 图标 URL
        icon_url = ""
        icon_hash = desc.get("icon_url", "")
        if icon_hash:
            icon_url = f"https://community.akamai.steamstatic.com/economy/image/{icon_hash}/256x256f"

        items.append({
            "assetid": asset.get("assetid", ""),
            "market_hash_name": desc.get("market_hash_name", ""),
            "name": desc.get("name", ""),
            "type": item_type,
            "weapon": weapon,
            "exterior": exterior,
            "exterior_raw": exterior_raw,
            "quality": quality,
            "quality_raw": quality_raw,
            "rarity": rarity_cn,
            "rarity_raw": rarity_raw,
            "rarity_color": rarity_color,
            "icon_url": icon_url,
            "tradable": desc.get("tradable", 1) == 1,
            "marketable": desc.get("marketable", 1) == 1,
            "amount": int(asset.get("amount", 1)),
            "float_value": None,
        })

    if len(all_assets) < total_count:
        print(f"  [库存] API 返回 {len(all_assets)}/{total_count} 件, 缺 {total_count - len(all_assets)} 件 (可能含未公开物品)" + (" (已配置 Cookie)" if config.STEAM_COOKIE else ""))
    if skipped > 0:
        print(f"  [库存] 其中 {skipped} 件未能匹配描述")
    if page > 1:
        print(f"  [库存] 分 {page} 页获取")

    return {"success": True, "items": items, "total_count": total_count, "error": None}


def lookup_prices_batch(market_hash_names, delay=1.0):
    """批量查询饰品价格（csqaq 批量接口，最多 50 个/次）

    Args:
        market_hash_names: market_hash_name 列表
        delay: 批次间延迟秒数

    Returns:
        dict: {marketHashName: {price, buff_price, yyyp_price, steam_price, item_id, name_cn}}
    """
    if not market_hash_names:
        return {}

    url = "https://api.csqaq.com/api/v1/goods/getPriceByMarketHashName"
    headers = {"ApiToken": config.API_TOKEN, "Content-Type": "application/json"}

    result = {}

    # 按 50 个一批拆分
    for i in range(0, len(market_hash_names), 50):
        batch = market_hash_names[i:i + 50]
        payload = json.dumps({"marketHashNameList": batch})

        try:
            if i > 0:
                time.sleep(delay)

            resp = requests.post(url, headers=headers, data=payload.encode("utf-8"),
                                 timeout=config.REQUEST_TIMEOUT)

            if resp.status_code == 429:
                print(f"  [批量价格] 429 限流，批次 {i // 50 + 1}，等待 3s 重试")
                time.sleep(3)
                resp = requests.post(url, headers=headers, data=payload.encode("utf-8"),
                                     timeout=config.REQUEST_TIMEOUT)

            if resp.status_code != 200:
                print(f"  [批量价格] HTTP {resp.status_code}，跳过批次 {i // 50 + 1}")
                continue

            data = resp.json()
            if data.get("code") != 200:
                print(f"  [批量价格] API code={data.get('code')}, msg={data.get('msg')}")
                continue

            success = data.get("data", {}).get("success", {})
            errors = data.get("data", {}).get("error", [])

            for mhn, info in success.items():
                if not isinstance(info, dict):
                    continue
                buff_raw = info.get("buffSellPrice", 0) or 0
                yyyp_raw = info.get("yyypSellPrice", 0) or 0
                steam_raw = float(info.get("steamSellPrice", 0) or 0)

                # 价格已为元，无价格时为 None
                buff_price = round(float(buff_raw), 2) if buff_raw else None
                yyyp_price = round(float(yyyp_raw), 2) if yyyp_raw else None
                steam_price = round(steam_raw, 2) if steam_raw else None

                # 主价格优先悠悠有品，其次 buff，最后 steam
                main_price = yyyp_price or buff_price or steam_price

                result[mhn] = {
                    "price": main_price,
                    "buff_price": buff_price,
                    "yyyp_price": yyyp_price,
                    "steam_price": steam_price,
                    "item_id": str(info.get("goodId", "")),
                    "name_cn": info.get("name", ""),
                }

            if errors:
                print(f"  [批量价格] {len(errors)} 个未匹配: {errors[:5]}...")

        except Exception as e:
            print(f"  [批量价格] 异常: {e}")
            continue

    return result
