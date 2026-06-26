# -*- coding: utf-8 -*-
"""全局配置常量"""

import os
from dotenv import load_dotenv

load_dotenv()

# API 密钥
API_TOKEN = os.getenv("API_TOKEN")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL")
DEEPSEEK_CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-v4-flash")

# 文件路径
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID_MAP_FILE = os.path.join(_BASE_DIR, "data", "饰品id_20260423.json")

# 超时设置 (秒)
REQUEST_TIMEOUT = 15
AI_TIMEOUT = 120

# AI 模型参数
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0"))
CHAT_TEMPERATURE = float(os.getenv("CHAT_TEMPERATURE", "0"))

# 查询周期预设 (天数)
PERIOD_PRESETS = {
    "1": ("最近1周", 7),
    "2": ("最近1个月", 30),
    "3": ("最近3个月", 90),
    "4": ("最近半年", 180),
    "5": ("最近1年", 365),
    "6": ("最近2年", 730),
}

# 输出目录
OUTPUT_DIR = "analysis_output"
DATA_DIR = "data"

# CS2 磨损度标签
WEAR_LEVELS = ["崭新出厂", "略有磨损", "久经沙场", "破损不堪", "战痕累累"]
