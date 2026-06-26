# -*- coding: utf-8 -*-
"""DeepSeek AI 多维度技术分析 + 多轮对话"""

import json
import time
import requests
import pandas as pd

from .config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_CHAT_MODEL, AI_TIMEOUT, AI_TEMPERATURE, CHAT_TEMPERATURE

AI_MAX_RETRIES = 2  # 超时/网络错误时最多重试 2 次


def _build_ai_prompt(df, item_name, period_days, recommendation):
    """构建发送给 DeepSeek AI 的全面分析提示词"""
    last = df.iloc[-1]
    first = df.iloc[0]
    last_price = last["close"]
    first_price = first["close"]
    total_change = (last_price - first_price) / first_price * 100

    recent = df.tail(30) if len(df) >= 30 else df
    high = df["close"].max()
    low = df["close"].min()
    high_7d = recent["close"].max()
    low_7d = recent["close"].min()
    high_30d = recent["close"].max()
    low_30d = recent["close"].min()

    # 分段统计
    if len(df) >= 90:
        seg_30 = df.tail(30)
        seg_60_30 = df.iloc[-60:-30] if len(df) >= 60 else df.iloc[:-30]
        seg_90_60 = df.iloc[-90:-60] if len(df) >= 90 else df.iloc[:-60]
        change_30 = (seg_30["close"].iloc[-1] - seg_30["close"].iloc[0]) / seg_30["close"].iloc[0] * 100
        change_60_30 = (seg_60_30["close"].iloc[-1] - seg_60_30["close"].iloc[0]) / seg_60_30["close"].iloc[0] * 100 if len(seg_60_30) > 1 else 0
        change_90_60 = (seg_90_60["close"].iloc[-1] - seg_90_60["close"].iloc[0]) / seg_90_60["close"].iloc[0] * 100 if len(seg_90_60) > 1 else 0
        seg_stats = (
            f"近30日涨跌: {change_30:+.2f}%\n"
            f"30-60日前涨跌: {change_60_30:+.2f}%\n"
            f"60-90日前涨跌: {change_90_60:+.2f}%"
        )
    else:
        seg_stats = "数据不足，无法分段统计"

    # 技术指标快照
    indicators = [
        f"当前价格: ￥{last_price:.2f}",
        f"周期涨跌幅: {total_change:+.2f}%",
        f"周期最高: ￥{high:.2f} / 最低: ￥{low:.2f}",
        f"近7日最高: ￥{high_7d:.2f} / 最低: ￥{low_7d:.2f}",
        f"近30日最高: ￥{high_30d:.2f} / 最低: ￥{low_30d:.2f}",
    ]
    if not pd.isna(last.get("MA5")):   indicators.append(f"MA5: ￥{last['MA5']:.2f}")
    if not pd.isna(last.get("MA10")):  indicators.append(f"MA10: ￥{last['MA10']:.2f}")
    if not pd.isna(last.get("MA20")):  indicators.append(f"MA20: ￥{last['MA20']:.2f}")
    if not pd.isna(last.get("MA60")):  indicators.append(f"MA60: ￥{last['MA60']:.2f}")
    if not pd.isna(last.get("RSI")):   indicators.append(f"RSI(14): {last['RSI']:.1f}")
    if not pd.isna(last.get("MACD")):  indicators.append(f"MACD: {last['MACD']:.4f}")
    if not pd.isna(last.get("MACD_Signal")): indicators.append(f"MACD Signal: {last['MACD_Signal']:.4f}")
    if not pd.isna(last.get("MACD_Hist")):   indicators.append(f"MACD Hist: {last['MACD_Hist']:.4f}")
    if not pd.isna(last.get("BB_Up")):   indicators.append(f"布林上轨: ￥{last['BB_Up']:.2f}")
    if not pd.isna(last.get("BB_Mid")):  indicators.append(f"布林中轨: ￥{last['BB_Mid']:.2f}")
    if not pd.isna(last.get("BB_Low")):  indicators.append(f"布林下轨: ￥{last['BB_Low']:.2f}")
    if not pd.isna(last.get("Momentum")):    indicators.append(f"5日动量: {last['Momentum']:.2f}%")
    if not pd.isna(last.get("Volatility")):  indicators.append(f"20日波动率: {last['Volatility']:.2f}%")

    # 均线乖离率
    if not pd.isna(last.get("MA20")) and last["MA20"] > 0:
        bias = (last_price - last["MA20"]) / last["MA20"] * 100
        indicators.append(f"MA20乖离率: {bias:+.2f}%")

    # 布林带宽度
    if not pd.isna(last.get("BB_Up")) and not pd.isna(last.get("BB_Low")) and last["BB_Low"] > 0:
        bb_width = (last["BB_Up"] - last["BB_Low"]) / last["BB_Mid"] * 100
        indicators.append(f"布林带宽: {bb_width:.2f}%")

    # 在售数量分析
    sell_num_stats = ""
    if "sell_num" in df.columns and df["sell_num"].sum() > 0:
        cur_sell = df["sell_num"].iloc[-1]
        avg_sell = df["sell_num"].mean()
        max_sell = df["sell_num"].max()
        min_sell = df["sell_num"].min()
        sell_change = (df["sell_num"].iloc[-1] - df["sell_num"].iloc[-6] if len(df) >= 6 else 0)
        indicators.append(f"当前在售: {cur_sell}件 | 均值: {avg_sell:.0f}件 | 最高: {max_sell}件 | 最低: {min_sell}件")
        trend = "增加" if sell_change > 0 else "减少"
        sell_num_stats = (
            f"当前在售数量: {cur_sell} 件 (供给端指标, 非成交量)\n"
            f"周期均值: {avg_sell:.0f} 件 | 最高: {max_sell} 件 | 最低: {min_sell} 件\n"
            f"近5日变化: {trend} {abs(sell_change)} 件\n"
            f"含义: 在售增加=抛压加大/供给充裕, 在售减少=惜售/供给收缩\n"
        )

    # 规则引擎建议
    rec_context = (
        f"规则引擎评分: {recommendation['score']:+.1f}/100\n"
        f"规则引擎建议: {recommendation['action_text']}\n"
        f"规则引擎信号:\n" +
        "\n".join(f"  - {d}" for d in recommendation['details'])
    )

    # 最近N条价格+在售数据: ≤30天取全部, >30天取最近30条
    tail_n = len(df) if period_days <= 30 else min(len(df), 30)
    rdf = df.tail(tail_n)[["time", "close"]].copy()
    rdf["time_str"] = rdf["time"].dt.strftime("%m-%d %H:%M")
    price_lines = []
    for idx, (_, r) in enumerate(rdf.iterrows()):
        line = f"  {r['time_str']}  ￥{r['close']:.2f}"
        if "sell_num" in df.columns:
            sell_at_idx = df["sell_num"].iloc[-(tail_n - idx)] if idx < tail_n and (len(df) - tail_n + idx) >= 0 else ""
            if sell_at_idx != "":
                line += f"  在售: {int(sell_at_idx)}件"
        price_lines.append(line)
    price_list = "\n".join(price_lines)

    prompt = f"""请对以下CS2饰品进行全面、深度的多维度技术分析，给出专业的买卖持仓建议。

【基本信息】
饰品名称: {item_name}
查询周期: 近{period_days}天
数据点数: {len(df)}条

【价格概况】
{chr(10).join(indicators)}

【分阶段涨跌统计】
{seg_stats}

【在售数量分析（悠悠有品）】
{sell_num_stats}

【近期价格+在售走势（近{tail_n}条）】
{price_list}

【规则引擎预分析】
{rec_context}

请从以下12个维度进行全面分析（每个维度3-5句话，深入细致）：

1. 综合建议与操作计划 — 给出明确的买入/持有/卖出/观望结论（含置信度 高/中/低）。为短线交易者和中长期持有者分别给出具体的操作计划。

2. 趋势分析 — 当前处于上升/下降/盘整的哪个阶段？短期(5日)、中期(20日)、长期(60日)趋势分别如何？均线排列形态及其演变方向？

3. 均线系统 — MA5/MA10/MA20/MA60之间的位置关系和斜率变化，是否存在金叉/死叉信号？均线是发散还是收敛？这对未来走势意味着什么？

4. 支撑与压力 — 详细列出关键支撑位和压力位（至少各3个），包括均线支撑、布林带边界、前期高/低点、整数关口。哪些是最强的支撑/压力？

5. RSI与动能 — RSI当前所处的区域含义是什么？是否存在顶背离或底背离？5日动量和20日波动率透露了什么市场情绪？

6. MACD深度解读 — MACD柱线变化趋势、DIF与DEA的位置关系和开口方向。是否存在加速上涨/下跌信号？MACD与价格是否存在背离？

7. 布林带分析 — 带宽是扩张还是收缩？价格在带内的相对位置？带宽变化预示着什么方向的突破？布林带的支撑压力有效性如何？

8. 在售数量与供给分析 — 注意: 在售数量是供给端指标而非实际成交量。结合悠悠有品在售数量的变化趋势，分析供给端变化：在售增加→抛压加大/供给充裕，在售减少→惜售/供给收缩。在售数量与价格走势是否存在联动关系（如价涨量增=强势、价跌量增=恐慌抛售）？当前在售水平处于什么位置（高位/均值/低位）？这对价格意味着什么？

9. 技术形态识别 — 是否出现头肩顶/底、双顶/底、三角形整理、旗形、楔形等经典形态？形态的目标价位是多少？

10. 多周期综合判断 — 综合各个时间维度（短期1周、中期1月、长期3月+），分别给出看涨/看跌/震荡的判断，并指出多周期是否共振还是矛盾。

11. 止损止盈与仓位 — 如果现在入场，建议的止损价和止盈价分别是多少？建议的仓位比例？盈亏比是否合理？

12. 风险与黑天鹅 — 有哪些潜在的重大风险？（如CS2游戏更新、市场整体转向、该武器皮肤热度变化、大商出货等）

请用中文输出，控制在800字以内，条理清晰，编号对应维度，给出具体可操作的建议。"""

    return prompt


def get_ai_analysis(df, item_name, period_days, recommendation):
    """调用 DeepSeek API 进行多维度 AI 技术分析

    返回:
      (success: bool | None, text: str)
        success=True  → AI 分析成功, text 为分析内容
        success=False → 未配置 API key, text 为提示信息
        success=None  → 调用失败, text 为错误信息
    """
    if not DEEPSEEK_API_KEY:
        return False, "未配置 DEEPSEEK_API_KEY，跳过AI分析。\n\n请在 .env 文件中添加:\nDEEPSEEK_API_KEY=your_key_here"

    prompt = _build_ai_prompt(df, item_name, period_days, recommendation)

    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({
        "model": DEEPSEEK_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是一位顶级的CS2/CSGO饰品交易分析师，拥有多年的游戏饰品投资和操盘经验。"
                    "你精通技术分析、市场心理学和风险管理，"
                    "能够从多维度、多时间框架综合分析饰品价格走势。"
                    "请基于提供的客观数据，给出全面、深入、可操作的专业分析报告。"
                    "回答必须使用中文，编号对应分析维度，条理清晰，直接给出结论。"
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": AI_TEMPERATURE,
        "max_tokens": 16384,
    })

    last_error = None
    for attempt in range(AI_MAX_RETRIES + 1):
        try:
            label = f"(第{attempt + 1}次尝试)..." if attempt > 0 else "..."
            print(f"正在进行多维度技术分析{label}")
            resp = requests.post(url, headers=headers, data=payload, timeout=AI_TIMEOUT)

            if resp.status_code != 200:
                return None, f"AI API 请求失败 (HTTP {resp.status_code})\n{resp.text[:300]}"

            result = resp.json()
            ai_text = result["choices"][0]["message"]["content"]
            return True, ai_text

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_error = e
            if attempt < AI_MAX_RETRIES:
                wait = (attempt + 1) * 5
                print(f"  连接超时，{wait}秒后重试...")
                time.sleep(wait)
            else:
                return None, (
                    f"AI 分析请求超时（已重试{AI_MAX_RETRIES}次，每次{AI_TIMEOUT}秒）。\n"
                    "建议: 1) 检查网络是否需要代理  2) 选择更短的查询周期  3) 稍后重试"
                )
        except Exception as e:
            return None, f"AI 分析出错: {type(e).__name__}: {e}"


def chat_with_context(messages, new_question):
    """基于完整对话历史发送追问，并返回 AI 回复。

    将用户的新问题追加到 messages 数组末尾，把整个对话历史
    发送给 DeepSeek，获取回复后将其追加到 messages 并返回。

    Args:
        messages: list[dict]  对话历史，格式:
                  [{"role": "system", "content": "..."},
                   {"role": "user", "content": "..."},
                   {"role": "assistant", "content": "..."}, ...]
        new_question: str  用户的追问内容

    Returns:
        (success: bool | None, text: str)
          success=True  → 追问成功, text 为 AI 回复
          success=False → 未配置 API key
          success=None  → 调用失败, text 为错误信息
    """
    if not DEEPSEEK_API_KEY:
        return False, "未配置 DEEPSEEK_API_KEY"

    # 追加用户追问
    messages.append({"role": "user", "content": new_question})

    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({
        "model": DEEPSEEK_CHAT_MODEL,
        "messages": messages,
        "temperature": CHAT_TEMPERATURE,
        "max_tokens": 8192,
    })

    last_error = None
    for attempt in range(AI_MAX_RETRIES + 1):
        try:
            label = f"(第{attempt + 1}次尝试)..." if attempt > 0 else ""
            print(f"正在获取AI追问回复{label}")
            resp = requests.post(url, headers=headers, data=payload, timeout=AI_TIMEOUT)

            if resp.status_code != 200:
                return None, f"AI API 请求失败 (HTTP {resp.status_code})\n{resp.text[:300]}"

            result = resp.json()
            ai_text = result["choices"][0]["message"]["content"]

            # 追加 AI 回复到对话历史
            messages.append({"role": "assistant", "content": ai_text})
            return True, ai_text

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_error = e
            if attempt < AI_MAX_RETRIES:
                wait = (attempt + 1) * 5
                print(f"  连接超时，{wait}秒后重试...")
                time.sleep(wait)
            else:
                return None, (
                    f"AI 追问请求超时（已重试{AI_MAX_RETRIES}次，每次{AI_TIMEOUT}秒）。\n"
                    "请稍后重试。"
                )
        except Exception as e:
            return None, f"AI 追问出错: {type(e).__name__}: {e}"

    return None, str(last_error) if last_error else "未知错误"
