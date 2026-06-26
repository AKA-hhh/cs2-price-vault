# -*- coding: utf-8 -*-
"""ID 映射加载与模糊搜索"""

import json
import os
import difflib


def load_id_map(file_path):
    """加载饰品ID映射文件，返回 (name→id, market_name→id, id→name)"""
    if not os.path.exists(file_path):
        print(f"错误：找不到文件 '{file_path}'")
        return None, None, None

    with open(file_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    name_to_id, market_to_id, id_to_name = {}, {}, {}
    for item in data:
        if "id" in item and "name" in item and "market_hash_name" in item:
            iid = item["id"]
            name_to_id[item["name"]] = iid
            market_to_id[item["market_hash_name"]] = iid
            id_to_name[iid] = item["name"]

    print(f"已加载 {len(name_to_id)} 个饰品映射")
    return name_to_id, market_to_id, id_to_name


def search_item(keyword, name_to_id, market_to_id):
    """模糊匹配饰品名称，返回 [(显示名, id), ...]

    优先子串包含匹配，再补充 difflib 模糊匹配。
    """
    if not keyword:
        return []

    all_names = list(name_to_id.keys()) + list(market_to_id.keys())
    kw_lower = keyword.lower()
    seen_ids = set()
    result = []

    # 第一轮: 子串包含匹配 (最精准，优先展示)
    for name in all_names:
        if kw_lower in name.lower():
            iid = name_to_id.get(name) or market_to_id.get(name)
            if iid not in seen_ids:
                seen_ids.add(iid)
                if name in name_to_id:
                    result.append((name, iid))
                else:
                    cn = next((cn for cn, cid in name_to_id.items() if cid == iid), None)
                    result.append((f"{cn} ({name})" if cn else name, iid))

    # 第二轮: difflib 模糊匹配 (补充拼写错误等场景)
    fuzzy_matches = difflib.get_close_matches(keyword, all_names, n=15, cutoff=0.3)
    for m in fuzzy_matches:
        iid = name_to_id.get(m) or market_to_id.get(m)
        if iid not in seen_ids:
            seen_ids.add(iid)
            if m in name_to_id:
                result.append((m, iid))
            else:
                cn = next((cn for cn, cid in name_to_id.items() if cid == iid), None)
                result.append((f"{cn} ({m})" if cn else m, iid))

    return result
