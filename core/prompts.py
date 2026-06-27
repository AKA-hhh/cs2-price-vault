# -*- coding: utf-8 -*-
"""提示词管理器 — 多模板 + 选择器，JSON 持久化"""

import os
import json
import uuid

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_FILE = os.path.join(BASE_DIR, "prompts.json")

DEFAULT_TEMPLATES = {
    "analysis_system": {
        "label": "分析 System Prompt",
        "desc": "设定 AI 在初次技术分析时的角色和行为准则。",
        "items": [
            {
                "id": "default",
                "name": "默认",
                "builtin": True,
                "text": (
                    "你是一位顶级的CS2/CSGO饰品交易分析师，拥有多年的游戏饰品投资和操盘经验。"
                    "你精通技术分析、市场心理学和风险管理，"
                    "能够从多维度、多时间框架综合分析饰品价格走势。"
                    "请基于提供的客观数据，给出全面、深入、可操作的专业分析报告。"
                    "回答必须使用中文，编号对应分析维度，条理清晰，直接给出结论。"
                ),
            }
        ],
    },
    "analysis_instruction": {
        "label": "分析维度指令",
        "desc": "定义 AI 技术分析的维度框架和输出格式要求。",
        "items": [
            {
                "id": "default",
                "name": "默认",
                "builtin": True,
                "text": (
                    "请从以下12个维度进行全面分析（每个维度3-5句话，深入细致）：\n"
                    "\n"
                    "1. 综合建议与操作计划 — 给出明确的买入/持有/卖出/观望结论（含置信度 高/中/低）。为短线交易者和中长期持有者分别给出具体的操作计划。\n"
                    "\n"
                    "2. 趋势分析 — 当前处于上升/下降/盘整的哪个阶段？短期(5日)、中期(20日)、长期(60日)趋势分别如何？均线排列形态及其演变方向？\n"
                    "\n"
                    "3. 均线系统 — MA5/MA10/MA20/MA60之间的位置关系和斜率变化，是否存在金叉/死叉信号？均线是发散还是收敛？这对未来走势意味着什么？\n"
                    "\n"
                    "4. 支撑与压力 — 详细列出关键支撑位和压力位（至少各3个），包括均线支撑、布林带边界、前期高/低点、整数关口。哪些是最强的支撑/压力？\n"
                    "\n"
                    "5. RSI与动能 — RSI当前所处的区域含义是什么？是否存在顶背离或底背离？5日动量和20日波动率透露了什么市场情绪？\n"
                    "\n"
                    "6. MACD深度解读 — MACD柱线变化趋势、DIF与DEA的位置关系和开口方向。是否存在加速上涨/下跌信号？MACD与价格是否存在背离？\n"
                    "\n"
                    "7. 布林带分析 — 带宽是扩张还是收缩？价格在带内的相对位置？带宽变化预示着什么方向的突破？布林带的支撑压力有效性如何？\n"
                    "\n"
                    "8. 在售数量与供给分析 — 注意: 在售数量是供给端指标而非实际成交量。结合悠悠有品在售数量的变化趋势，分析供给端变化：在售增加→抛压加大/供给充裕，在售减少→惜售/供给收缩。在售数量与价格走势是否存在联动关系（如价涨量增=强势、价跌量增=恐慌抛售）？当前在售水平处于什么位置（高位/均值/低位）？这对价格意味着什么？\n"
                    "\n"
                    "9. 技术形态识别 — 是否出现头肩顶/底、双顶/底、三角形整理、旗形、楔形等经典形态？形态的目标价位是多少？\n"
                    "\n"
                    "10. 多周期综合判断 — 综合各个时间维度（短期1周、中期1月、长期3月+），分别给出看涨/看跌/震荡的判断，并指出多周期是否共振还是矛盾。\n"
                    "\n"
                    "11. 止损止盈与仓位 — 如果现在入场，建议的止损价和止盈价分别是多少？建议的仓位比例？盈亏比是否合理？\n"
                    "\n"
                    "12. 风险与黑天鹅 — 有哪些潜在的重大风险？（如CS2游戏更新、市场整体转向、该武器皮肤热度变化、大商出货等）\n"
                    "\n"
                    "请用中文输出，控制在800字以内，条理清晰，编号对应维度，给出具体可操作的建议。"
                ),
            }
        ],
    },
    "chat_system": {
        "label": "追问 System Prompt",
        "desc": "设定 AI 在多轮追问对话中的角色和行为准则。",
        "items": [
            {
                "id": "default",
                "name": "默认",
                "builtin": True,
                "text": (
                    "你是一位顶级的CS2/CSGO饰品交易分析师，拥有多年的游戏饰品投资和操盘经验。"
                    "你精通技术分析、市场心理学和风险管理，"
                    "能够从多维度、多时间框架综合分析饰品价格走势。"
                    "当用户追问时，请基于之前的分析数据给出具体、可操作的回答。"
                    "回答必须使用中文，条理清晰，直接给出结论。"
                ),
            }
        ],
    },
    "portfolio_advice": {
        "label": "持仓建议模板",
        "desc": "用于生成持仓 AI 建议的提示词模板。",
        "vars": ["{name}", "{buy_price}", "{quantity}", "{total_cost}", "{current_price}", "{current_value}", "{pnl}", "{pnl_pct}"],
        "items": [
            {
                "id": "default",
                "name": "默认",
                "builtin": True,
                "text": (
                    "你是一位 CS2 饰品投资顾问。用户持有以下饰品，请给出操作建议：\n"
                    "\n"
                    "饰品：{name}\n"
                    "买入均价：¥{buy_price:.2f}\n"
                    "持有数量：{quantity} 件\n"
                    "投入成本：¥{total_cost:.2f}\n"
                    "当前市价（悠悠有品）：¥{current_price:.2f}\n"
                    "当前市值：¥{current_value:.2f}\n"
                    "浮动盈亏：¥{pnl:+.2f} ({pnl_pct:+.1f}%)\n"
                    "\n"
                    "请从以下角度分析并给出建议：\n"
                    "1. 当前盈亏状况评估\n"
                    "2. 建议操作（持有/加仓/减仓/清仓）\n"
                    "3. 关键支撑位和压力位\n"
                    "4. 风险提示\n"
                    "\n"
                    "请用中文回答，简洁专业，不超过 500 字。"
                ),
            }
        ],
    },
}


def _migrate_old_format(data, default_text):
    """将旧格式 {default, custom, use_custom} 迁移到新格式"""
    if "items" in data:
        return data  # 已经是新格式
    old_default = data.get("default", default_text)
    old_custom = data.get("custom", "")
    old_use = data.get("use_custom", False)
    items = [
        {"id": "default", "name": "默认", "builtin": True, "text": old_default or default_text},
    ]
    active_id = "default"
    if old_use and old_custom:
        cid = uuid.uuid4().hex[:8]
        items.append({"id": cid, "name": "自定义", "builtin": False, "text": old_custom})
        active_id = cid
    return {"items": items, "active_id": active_id}


class PromptManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._data = {}
        self._load()

    def _load(self):
        if os.path.exists(PROMPTS_FILE):
            try:
                with open(PROMPTS_FILE, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
            except (json.JSONDecodeError, IOError):
                loaded = {}
        else:
            loaded = {}

        for key, default_entry in DEFAULT_TEMPLATES.items():
            default_text = default_entry["items"][0]["text"] if default_entry.get("items") else ""
            if key in loaded:
                entry = _migrate_old_format(loaded[key], default_text)
            else:
                entry = {
                    "items": list(default_entry["items"]),
                    "active_id": "default",
                }
            # 确保 label/desc 有值
            entry["label"] = loaded.get(key, {}).get("label") or default_entry.get("label", key)
            entry["desc"] = loaded.get(key, {}).get("desc") or default_entry.get("desc", "")
            entry["vars"] = loaded.get(key, {}).get("vars") or default_entry.get("vars", [])
            # 确保每个 item 都有 builtin 标记
            def_ids = {it["id"] for it in default_entry.get("items", [])}
            for item in entry.get("items", []):
                if "builtin" not in item:
                    item["builtin"] = item["id"] in def_ids
            self._data[key] = entry

        # 确保 active_id 存在
        for key, entry in self._data.items():
            ids = {it["id"] for it in entry.get("items", [])}
            if entry.get("active_id") not in ids:
                entry["active_id"] = "default"
        self._save()

    def _save(self):
        try:
            with open(PROMPTS_FILE, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存 prompts.json 失败: {e}")

    def _find_item(self, key, tid):
        entry = self._data.get(key)
        if not entry:
            return None, None
        for item in entry.get("items", []):
            if item["id"] == tid:
                return entry, item
        return entry, None

    def get(self, key):
        """返回当前激活模板的文本"""
        entry = self._data.get(key)
        if not entry:
            return ""
        active_id = entry.get("active_id", "default")
        for item in entry.get("items", []):
            if item["id"] == active_id:
                return item["text"]
        # fallback
        if entry.get("items"):
            return entry["items"][0]["text"]
        return ""

    def get_all(self):
        """返回完整数据（供前端渲染）"""
        return dict(self._data)

    def set_active(self, key, tid):
        """切换当前使用的模板"""
        entry = self._data.get(key)
        if not entry:
            return False
        if not any(it["id"] == tid for it in entry.get("items", [])):
            return False
        entry["active_id"] = tid
        self._save()
        return True

    def add_template(self, key, name, text):
        """新建自定义模板，返回新模板 id"""
        entry = self._data.get(key)
        if not entry:
            return None
        tid = uuid.uuid4().hex[:8]
        entry.setdefault("items", []).append({
            "id": tid, "name": name.strip(), "text": text, "builtin": False,
        })
        self._save()
        return tid

    def update_template(self, key, tid, name=None, text=None):
        """更新模板名称/内容（builtin 不可修改）"""
        entry, item = self._find_item(key, tid)
        if not item:
            return False
        if item.get("builtin"):
            return False
        if name is not None:
            item["name"] = name.strip()
        if text is not None:
            item["text"] = text
        self._save()
        return True

    def delete_template(self, key, tid):
        """删除自定义模板（builtin 不可删），若删除的是当前激活则切回 default"""
        entry, item = self._find_item(key, tid)
        if not item:
            return False
        if item.get("builtin"):
            return False
        entry["items"] = [it for it in entry.get("items", []) if it["id"] != tid]
        if entry.get("active_id") == tid:
            entry["active_id"] = "default"
        self._save()
        return True


prompt_mgr = PromptManager()
