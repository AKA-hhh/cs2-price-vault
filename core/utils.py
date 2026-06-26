# -*- coding: utf-8 -*-
"""通用工具函数"""

import re
import os

from .config import WEAR_LEVELS, DATA_DIR


def extract_wear_level(item_name):
    """从饰品名称中提取磨损度，无磨损度则返回空字符串"""
    for w in WEAR_LEVELS:
        if w in item_name:
            return w
    return ""


def sanitize_filename(name):
    """清理文件名中的非法字符"""
    bad = r'\/:*?"<>|'
    for ch in bad:
        name = name.replace(ch, "_")
    return name[:80]


def sanitize_for_display(text):
    """移除或替换文本中 matplotlib/SimHei 无法渲染的字符"""
    text = re.sub(r'[\U0001F300-\U0001FAFF]', '', text)
    text = re.sub(r'[☀-➿]', '', text)
    text = re.sub(r'[⭐⚠⚡⚪❗❓]', '', text)
    result = []
    for ch in text:
        try:
            ch.encode('gbk')
            result.append(ch)
        except UnicodeEncodeError:
            result.append(' ')
    return ''.join(result)


def save_to_csv(df, item_name, period_days):
    """保存价格数据到 CSV（存入 data/ 文件夹）"""
    safe_name = sanitize_filename(item_name)
    filename = f"{safe_name}_{period_days}d.csv"
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), DATA_DIR)
    os.makedirs(out_dir, exist_ok=True)
    filepath = os.path.join(out_dir, filename)
    df.to_csv(filepath, index=False, encoding="utf-8-sig")
    print(f"数据已保存至: {filepath}")
    return filepath
