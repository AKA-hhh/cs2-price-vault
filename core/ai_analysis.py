# -*- coding: utf-8 -*-
"""DeepSeek AI 多维度技术分析 + 多轮对话"""

import json
import time
import requests
import pandas as pd

from . import config  # 通过 config.XXX 引用，确保 _write_env_value 更新后读取最新值
from .prompts import prompt_mgr

AI_MAX_RETRIES = 2  # 超时/网络错误时最多重试 2 次


def _build_ai_prompt(df, item_name, period_days, recommendation, knowledge=None):
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

{prompt_mgr.get("analysis_instruction")}"""

    # 附加知识库参考
    if knowledge:
        kb_text = "\n".join(
            f"  - [{e.get('title', '')}] {e.get('content', '')[:300]}"
            for e in knowledge[:5]
        )
        prompt += f"""

【参考CS2事件库（请选择性参考以下历史事件与规则，如与当前分析相关则纳入考量）】
{kb_text}
"""

    return prompt


def get_ai_analysis(df, item_name, period_days, recommendation, knowledge=None):
    """调用 DeepSeek API 进行多维度 AI 技术分析

    参数:
      knowledge: 可选，知识库条目列表，用于注入参考上下文

    返回:
      (success: bool | None, text: str)
    """
    if not config.DEEPSEEK_API_KEY:
        return False, "未配置 DEEPSEEK_API_KEY，跳过AI分析。\n\n请在 .env 文件中添加:\nDEEPSEEK_API_KEY=your_key_here"

    prompt = _build_ai_prompt(df, item_name, period_days, recommendation, knowledge)

    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({
        "model": config.DEEPSEEK_MODEL,
        "messages": [
            {
                "role": "system",
                "content": prompt_mgr.get("analysis_system"),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": config.AI_TEMPERATURE,
        "max_tokens": 16384,
    })

    last_error = None
    for attempt in range(AI_MAX_RETRIES + 1):
        try:
            label = f"(第{attempt + 1}次尝试)..." if attempt > 0 else "..."
            print(f"正在进行多维度技术分析{label}")
            resp = requests.post(url, headers=headers, data=payload, timeout=config.AI_TIMEOUT)

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
                    f"AI 分析请求超时（已重试{AI_MAX_RETRIES}次，每次{config.AI_TIMEOUT}秒）。\n"
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
    if not config.DEEPSEEK_API_KEY:
        return False, "未配置 DEEPSEEK_API_KEY"

    # 追加用户追问
    messages.append({"role": "user", "content": new_question})

    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({
        "model": config.DEEPSEEK_CHAT_MODEL,
        "messages": messages,
        "temperature": config.CHAT_TEMPERATURE,
        "max_tokens": 8192,
    })

    last_error = None
    for attempt in range(AI_MAX_RETRIES + 1):
        try:
            label = f"(第{attempt + 1}次尝试)..." if attempt > 0 else ""
            print(f"正在获取AI追问回复{label}")
            resp = requests.post(url, headers=headers, data=payload, timeout=config.AI_TIMEOUT)

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
                    f"AI 追问请求超时（已重试{AI_MAX_RETRIES}次，每次{config.AI_TIMEOUT}秒）。\n"
                    "请稍后重试。"
                )
        except Exception as e:
            return None, f"AI 追问出错: {type(e).__name__}: {e}"

    return None, str(last_error) if last_error else "未知错误"
