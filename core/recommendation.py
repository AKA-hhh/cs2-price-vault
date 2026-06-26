# -*- coding: utf-8 -*-
"""规则引擎 — 基于多维技术指标生成买卖持仓建议"""

import pandas as pd


def generate_recommendation(df):
    """基于多维技术指标生成买卖持仓建议。

    返回:
      {
        "action": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
        "action_text": "建议买入 [BUY]" ...,
        "score": -100 ~ 100,
        "details": ["说明文字", ...],
        "summary": "一段总结"
      }
    """
    if len(df) < 20:
        return {
            "action": "hold",
            "action_text": "数据不足，建议观望 [HOLD]",
            "score": 0,
            "details": [f"仅有 {len(df)} 条数据，至少需要20条才能分析"],
            "summary": "数据点不足，无法生成有效建议。请选择更长的查询周期。",
        }

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    score = 0.0
    details = []

    # ── 1. 均线趋势 (权重 20%) ──
    ma_score = 0
    if not pd.isna(last["MA5"]) and not pd.isna(last["MA20"]):
        if last["MA5"] > last["MA20"]:
            if not pd.isna(prev["MA5"]) and not pd.isna(prev["MA20"]) and prev["MA5"] <= prev["MA20"]:
                ma_score = 20
                details.append("** MA5 上穿 MA20（金叉），强烈看涨")
            else:
                ma_score = 12
                details.append("↑ MA5 位于 MA20 上方，短期趋势向上")
        else:
            if not pd.isna(prev["MA5"]) and not pd.isna(prev["MA20"]) and prev["MA5"] >= prev["MA20"]:
                ma_score = -20
                details.append("!! MA5 下穿 MA20（死叉），强烈看跌")
            else:
                ma_score = -12
                details.append("↓ MA5 位于 MA20 下方，短期趋势向下")
    score += ma_score

    # ── 2. 均线排列 (权重 15%) ──
    if not pd.isna(last["MA5"]) and not pd.isna(last["MA10"]) and not pd.isna(last["MA20"]):
        if last["MA5"] > last["MA10"] > last["MA20"]:
            score += 15
            details.append("↑ 均线多头排列 (MA5 > MA10 > MA20)")
        elif last["MA5"] < last["MA10"] < last["MA20"]:
            score -= 15
            details.append("↓ 均线空头排列 (MA5 < MA10 < MA20)")

    # ── 3. RSI (权重 20%) ──
    if not pd.isna(last["RSI"]):
        rsi = last["RSI"]
        if rsi < 25:
            score += 20
            details.append(f"** RSI={rsi:.1f}，深度超卖，反弹概率极高")
        elif rsi < 35:
            score += 10
            details.append(f"↑ RSI={rsi:.1f}，超卖区域，有反弹需求")
        elif rsi > 75:
            score -= 20
            details.append(f"!! RSI={rsi:.1f}，深度超买，回调概率极高")
        elif rsi > 65:
            score -= 10
            details.append(f"↓ RSI={rsi:.1f}，超买区域，有回调压力")
        else:
            details.append(f"→ RSI={rsi:.1f}，中性区间")

    # ── 4. MACD (权重 20%) ──
    if not pd.isna(last["MACD_Hist"]) and not pd.isna(prev["MACD_Hist"]):
        hist = last["MACD_Hist"]
        prev_hist = prev["MACD_Hist"]
        if prev_hist <= 0 and hist > 0:
            score += 20
            details.append("** MACD 金叉（柱线由负转正）")
        elif prev_hist >= 0 and hist < 0:
            score -= 20
            details.append("!! MACD 死叉（柱线由正转负）")
        elif hist > prev_hist and hist > 0:
            score += 8
            details.append("↑ MACD 柱线正值扩大，动能增强")
        elif hist < prev_hist and hist < 0:
            score -= 8
            details.append("↓ MACD 柱线负值扩大，动能减弱")
        elif hist > 0:
            score += 4
            details.append("↑ MACD 柱线为正")
        else:
            score -= 4
            details.append("↓ MACD 柱线为负")

    # ── 5. 布林带位置 (权重 10%) ──
    if not pd.isna(last["BB_Up"]) and not pd.isna(last["BB_Low"]) and not pd.isna(last["close"]):
        bb_range = last["BB_Up"] - last["BB_Low"]
        if bb_range > 0:
            bb_pos = (last["close"] - last["BB_Low"]) / bb_range
            if bb_pos < 0.08:
                score += 10
                details.append("** 价格触及布林带下轨，超跌信号")
            elif bb_pos < 0.2:
                score += 5
                details.append("↑ 价格接近布林带下轨，有一定支撑")
            elif bb_pos > 0.92:
                score -= 10
                details.append("!! 价格触及布林带上轨，超涨信号")
            elif bb_pos > 0.8:
                score -= 5
                details.append("↓ 价格接近布林带上轨，有一定压力")

    # ── 6. 近期动量 (权重 10%) ──
    if not pd.isna(last["Momentum"]):
        mom = last["Momentum"]
        if mom > 15:
            score -= 3
            details.append(f"↓ 近5日涨幅 {mom:.1f}%，短期涨幅过大需警惕")
        elif mom > 5:
            score += 5
            details.append(f"↑ 近5日涨幅 {mom:.1f}%，动量向上")
        elif mom < -15:
            score += 3
            details.append(f"↑ 近5日跌幅 {mom:.1f}%，短期超跌有反弹机会")
        elif mom < -5:
            score -= 5
            details.append(f"↓ 近5日跌幅 {mom:.1f}%，动量向下")

    # ── 7. 波动率 (权重 5%) ──
    if not pd.isna(last["Volatility"]):
        vol = last["Volatility"]
        if vol > 8:
            details.append(f"!! 20日波动率 {vol:.1f}%，波动较大，注意风险控制")
        elif vol < 2:
            details.append(f"-- 20日波动率 {vol:.1f}%，横盘整理中")

    # ── 综合判定 ──
    score = max(-100, min(100, score))

    if score >= 60:
        action, action_text = "strong_buy", "强烈建议买入 [BUY]"
    elif score >= 30:
        action, action_text = "buy", "建议买入 [BUY]"
    elif score > -30:
        action, action_text = "hold", "建议持有/观望 [HOLD]"
    elif score > -60:
        action, action_text = "sell", "建议卖出 [SELL]"
    else:
        action, action_text = "strong_sell", "强烈建议卖出 [SELL]"

    summary = _build_summary(df, score, details)

    return {
        "action": action,
        "action_text": action_text,
        "score": round(score, 1),
        "details": details,
        "summary": summary,
    }


def _build_summary(df, score, details):
    """生成自然语言总结"""
    last_price = df["close"].iloc[-1]
    first_price = df["close"].iloc[0]
    total_change = (last_price - first_price) / first_price * 100

    recent = df.tail(7) if len(df) >= 7 else df
    high = recent["close"].max()
    low = recent["close"].min()

    lines = [
        f"当前价格: ￥{last_price:.2f}",
        f"周期内涨跌幅: {total_change:+.2f}%",
        f"近7日最高: ￥{high:.2f} / 最低: ￥{low:.2f}",
    ]

    if not pd.isna(df["MA20"].iloc[-1]):
        lines.append(f"MA20 均线: ￥{df['MA20'].iloc[-1]:.2f}")
    if not pd.isna(df["BB_Low"].iloc[-1]) and not pd.isna(df["BB_Up"].iloc[-1]):
        lines.append(f"布林带: ￥{df['BB_Low'].iloc[-1]:.2f} ~ ￥{df['BB_Up'].iloc[-1]:.2f}")

    if score >= 60:
        lines.append("\n综合判断: 多项指标共振看涨，当前是较好的买入时机。")
    elif score >= 30:
        lines.append("\n综合判断: 技术面偏多，可考虑逢低建仓。")
    elif score > -30:
        lines.append("\n综合判断: 方向不明确，建议观望等待明确信号。")
    elif score > -60:
        lines.append("\n综合判断: 技术面偏空，持有者可考虑减仓。")
    else:
        lines.append("\n综合判断: 多项指标共振看跌，建议及时止盈/止损。")

    return "\n".join(lines)
