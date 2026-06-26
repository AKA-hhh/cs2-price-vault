# -*- coding: utf-8 -*-
"""可视化 — 走势图绘制 (价格+成交量+RSI+MACD+KDJ)"""

import os
import re
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Rectangle
from matplotlib.lines import Line2D

from .config import OUTPUT_DIR
from .utils import sanitize_filename, sanitize_for_display


def _draw_candlesticks(ax, df):
    """在坐标轴上绘制K线图"""
    has_ohlc = all(c in df.columns for c in ["open", "high", "low"])
    if not has_ohlc:
        return False

    # 计算柱体宽度 (日线 ~0.6天)
    time_range = (df["time"].iloc[-1] - df["time"].iloc[0]).total_seconds()
    if time_range <= 0:
        width = 0.6
    else:
        width = max(0.4, time_range / len(df) / 86400 * 0.8)

    for i, (_, row) in enumerate(df.iterrows()):
        t = mdates.date2num(row["time"])
        o, h, l, c = row["open"], row["high"], row["low"], row["close"]

        if c >= o:
            color = "#e74c3c"  # 阳线红色
            body_h = c - o
            body_bottom = o
        else:
            color = "#27ae60"  # 阴线绿色
            body_h = o - c
            body_bottom = c

        # 影线
        ax.plot([t, t], [l, h], color=color, linewidth=0.8, zorder=2)

        # 实体
        if body_h > 0:
            rect = Rectangle((t - width / 2, body_bottom), width, body_h,
                             facecolor=color, edgecolor=color, linewidth=0.5, zorder=3)
            ax.add_patch(rect)
        else:
            # 十字星: 画横线
            ax.plot([t - width / 2, t + width / 2], [c, c], color=color, linewidth=0.8, zorder=3)

    return True


def plot_analysis(df, item_name, period_days, recommendation, save_path=None, show=True):
    """绘制走势图：价格+成交量+RSI+MACD+KDJ"""
    n = len(df)
    if n < 2:
        print("数据点不足，无法绘图")
        return None

    has_sellnum = "sell_num" in df.columns and df["sell_num"].sum() > 0
    has_kdj = "KDJ_K" in df.columns and df["KDJ_K"].notna().any()

    # 行布局: 价格 | 成交量 | RSI | MACD | KDJ
    n_rows = 2
    ratios = [3.5, 0.9]
    n_rows += 1; ratios.append(0.8)  # RSI
    n_rows += 1; ratios.append(0.8)  # MACD
    if has_kdj:
        n_rows += 1; ratios.append(0.7)

    fig = plt.figure(figsize=(16, 12))
    gs = fig.add_gridspec(n_rows, 1, height_ratios=ratios, hspace=0.05)

    row = 0

    # ── 1. 主图: K线/价格 + 均线 + 布林带 ──
    ax1 = fig.add_subplot(gs[row]); row += 1

    use_kline = _draw_candlesticks(ax1, df)
    if not use_kline:
        ax1.plot(df["time"], df["close"], color="#1a1a2e", linewidth=1.2, label="收盘价", zorder=3)
        ax1.fill_between(df["time"], df["close"], alpha=0.08, color="#1a1a2e")

    colors = {"MA5": "#e74c3c", "MA10": "#e67e22", "MA20": "#2ecc71", "MA60": "#9b59b6"}
    for ma, c in colors.items():
        if ma in df.columns and df[ma].notna().any():
            ax1.plot(df["time"], df[ma], color=c, linewidth=0.8, linestyle="--", label=ma, alpha=0.85)

    if "BB_Up" in df.columns and df["BB_Up"].notna().any():
        ax1.fill_between(df["time"], df["BB_Low"], df["BB_Up"], alpha=0.08, color="#3498db", label="布林带 (±2σ)")
        ax1.plot(df["time"], df["BB_Up"], color="#3498db", linewidth=0.5, alpha=0.5)
        ax1.plot(df["time"], df["BB_Low"], color="#3498db", linewidth=0.5, alpha=0.5)

    if use_kline:
        # K线图例
        legend_kline = [
            Line2D([0], [0], color="#e74c3c", linewidth=3, label="阳线 (收盘≥开盘)"),
            Line2D([0], [0], color="#27ae60", linewidth=3, label="阴线 (收盘<开盘)"),
        ]
        handles, labels = ax1.get_legend_handles_labels()
        handles = legend_kline + handles
        labels = ["阳线 (收盘≥开盘)", "阴线 (收盘<开盘)"] + labels

    _mark_signals(ax1, df)

    title_suffix = "K线图" if use_kline else "价格走势"
    ax1.set_title(f"{item_name} — 近{period_days}天{title_suffix} (悠悠有品)", fontsize=14, fontweight="bold")
    ax1.set_ylabel("价格 (￥)", fontsize=10)
    if use_kline:
        ax1.legend(handles, labels, loc="upper left", fontsize=7, ncol=2, framealpha=0.8)
    else:
        ax1.legend(loc="upper left", fontsize=7, ncol=2, framealpha=0.8)
    ax1.grid(True, linestyle="--", alpha=0.3)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
    ax1.tick_params(labelbottom=False)

    # ── 2. 在售数量柱图 ──
    ax_vol = fig.add_subplot(gs[row], sharex=ax1); row += 1
    if has_sellnum:
        close_diff = df["close"].diff()
        up = close_diff >= 0
        down = close_diff < 0
        ax_vol.bar(df["time"][up], df["sell_num"][up], color="#e74c3c", width=1, alpha=0.6, label="价涨(在售增)")
        ax_vol.bar(df["time"][down], df["sell_num"][down], color="#27ae60", width=1, alpha=0.6, label="价跌(在售减)")
        if "SellNum_MA5" in df.columns and df["SellNum_MA5"].notna().any():
            ax_vol.plot(df["time"], df["SellNum_MA5"], color="#f39c12", linewidth=0.8, label="在售MA5")
        ax_vol.set_ylabel("在售(件)", fontsize=9)
        ax_vol.legend(loc="upper left", fontsize=7, ncol=3)
    else:
        ax_vol.text(0.5, 0.5, "无在售数据", transform=ax_vol.transAxes, ha="center", va="center", fontsize=10, color="#bdc3c7")
    ax_vol.grid(True, linestyle="--", alpha=0.3)
    ax_vol.tick_params(labelbottom=False)

    # ── 3. RSI ──
    ax2 = fig.add_subplot(gs[row], sharex=ax1); row += 1
    if "RSI" in df.columns and df["RSI"].notna().any():
        ax2.plot(df["time"], df["RSI"], color="#8e44ad", linewidth=1)
        ax2.axhline(70, color="#e74c3c", linestyle="--", linewidth=0.8, alpha=0.6)
        ax2.axhline(30, color="#27ae60", linestyle="--", linewidth=0.8, alpha=0.6)
        ax2.fill_between(df["time"], 70, df["RSI"], where=(df["RSI"] >= 70), color="#e74c3c", alpha=0.15)
        ax2.fill_between(df["time"], 30, df["RSI"], where=(df["RSI"] <= 30), color="#27ae60", alpha=0.15)
        ax2.set_ylim(0, 100)
    ax2.set_ylabel("RSI", fontsize=9)
    ax2.legend(["RSI (14)"], loc="upper left", fontsize=7)
    ax2.grid(True, linestyle="--", alpha=0.3)
    ax2.tick_params(labelbottom=False)

    # ── 4. MACD ──
    ax3 = fig.add_subplot(gs[row], sharex=ax1); row += 1
    if "MACD_Hist" in df.columns and df["MACD_Hist"].notna().any():
        pos = df["MACD_Hist"] >= 0
        neg = df["MACD_Hist"] < 0
        ax3.bar(df["time"][pos], df["MACD_Hist"][pos], color="#e74c3c", width=1, alpha=0.7, label="MACD柱 (+)" if pos.any() else "")
        ax3.bar(df["time"][neg], df["MACD_Hist"][neg], color="#27ae60", width=1, alpha=0.7, label="MACD柱 (-)" if neg.any() else "")
        ax3.plot(df["time"], df["MACD"], color="#2c3e50", linewidth=0.8, label="MACD")
        ax3.plot(df["time"], df["MACD_Signal"], color="#e67e22", linewidth=0.8, label="Signal")
        ax3.axhline(0, color="#7f8c8d", linestyle="-", linewidth=0.5)
    ax3.set_ylabel("MACD", fontsize=9)
    ax3.legend(loc="upper left", fontsize=7, ncol=3)
    ax3.grid(True, linestyle="--", alpha=0.3)
    ax3.tick_params(labelbottom=False)

    # ── 5. KDJ ──
    if has_kdj:
        ax_kdj = fig.add_subplot(gs[row], sharex=ax1); row += 1
        ax_kdj.plot(df["time"], df["KDJ_K"], color="#e74c3c", linewidth=0.8, label="K")
        ax_kdj.plot(df["time"], df["KDJ_D"], color="#27ae60", linewidth=0.8, label="D")
        ax_kdj.plot(df["time"], df["KDJ_J"], color="#8e44ad", linewidth=0.8, label="J")
        ax_kdj.axhline(80, color="#e74c3c", linestyle="--", linewidth=0.5, alpha=0.4)
        ax_kdj.axhline(20, color="#27ae60", linestyle="--", linewidth=0.5, alpha=0.4)
        ax_kdj.set_ylabel("KDJ", fontsize=9)
        ax_kdj.set_xlabel("日期", fontsize=10)
        ax_kdj.legend(loc="upper left", fontsize=7, ncol=3)
        ax_kdj.grid(True, linestyle="--", alpha=0.3)
        ax_kdj.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
    else:
        ax3.set_xlabel("日期", fontsize=10)

    for ax_i in fig.axes:
        ax_i.xaxis.set_major_locator(mdates.AutoDateLocator())
        for label in ax_i.get_xticklabels():
            label.set_rotation(30)

    fig.subplots_adjust(left=0.03, right=0.99, top=0.97, bottom=0.04)

    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fig.savefig(save_path, dpi=150, bbox_inches="tight",
                    facecolor="white", edgecolor="none")
        print(f"走势图已保存至: {save_path}")

    if show:
        plt.show()
    return save_path


def _render_ai_panel(ax, df, recommendation, ai_text):
    """在右侧面板渲染AI分析文本 — 顶部综合建议 + 明细分析 (保留备用)"""
    ai_text = re.sub(r'^好的[，,]\s*以下是对.+?(?:分析|报告)[。，：:\n]*', '', ai_text, count=1)
    ax.axis("off")
    ax.set_facecolor("#f8f9fa")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)

    action_colors = {
        "strong_buy": "#27ae60", "buy": "#2ecc71", "hold": "#95a5a6",
        "sell": "#e74c3c", "strong_sell": "#c0392b",
    }
    color = action_colors.get(recommendation["action"], "#95a5a6")
    action_labels = {
        "strong_buy": "强烈买入", "buy": "建议买入",
        "hold": "持有观望", "sell": "建议卖出", "strong_sell": "强烈卖出"
    }
    label = action_labels.get(recommendation["action"], "观望")

    last_price = df["close"].iloc[-1]
    ma20_val = df["MA20"].iloc[-1] if not pd.isna(df["MA20"].iloc[-1]) else None
    bb_low = df["BB_Low"].iloc[-1] if not pd.isna(df["BB_Low"].iloc[-1]) else None
    bb_up = df["BB_Up"].iloc[-1] if not pd.isna(df["BB_Up"].iloc[-1]) else None
    rsi_val = df["RSI"].iloc[-1] if not pd.isna(df["RSI"].iloc[-1]) else None

    parts = [f"现价: ￥{last_price:.0f}"]
    if ma20_val:
        parts.append(f"MA20: ￥{ma20_val:.0f}")
    if bb_low and bb_up:
        parts.append(f"布林: ￥{bb_low:.0f}~￥{bb_up:.0f}")
    if rsi_val:
        parts.append(f"RSI: {rsi_val:.0f}")
    header = f"综合建议: {label}    |    " + "  |  ".join(parts)

    ax.text(50, 98.5, header, transform=ax.transData, fontsize=11, fontweight="bold",
            color="white", ha="center", va="top",
            bbox=dict(boxstyle="round,pad=0.5", facecolor=color, alpha=0.95))

    buy_price = "-"
    sell_price = "-"
    if recommendation["action"] in ("strong_buy", "buy"):
        buy_price = f"￥{last_price:.0f} (当前入场)"
        sell_price = f"￥{bb_up:.0f} (布林上轨)" if bb_up else "-"
    elif recommendation["action"] in ("strong_sell", "sell"):
        sell_price = f"￥{last_price:.0f} (当前离场)"
        buy_price = f"￥{bb_low:.0f} (布林下轨)" if bb_low else "-"
    else:
        if bb_low:
            buy_price = f"￥{bb_low:.0f} (下轨)"
        if bb_up:
            sell_price = f"￥{bb_up:.0f} (上轨)"

    guide = f"参考买入: {buy_price}  |  参考卖出: {sell_price}  |  评分: {recommendation['score']:+.0f}/100"
    ax.text(50, 94.5, guide, transform=ax.transData, fontsize=9.5,
            color="#1a1a2e", ha="center", va="top",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="#e8f8f5", edgecolor="#2ecc71", alpha=0.85))

    ax.axhline(y=92, xmin=0.03, xmax=0.97, color="#2c3e50", linewidth=1.2)

    safe_text = sanitize_for_display(ai_text)
    lines = safe_text.split("\n")
    display_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            display_lines.append("")
            continue
        while len(line) > 48:
            break_at = 48
            for sep in ["。", "，", "；", "、", "）", "】", " ", ",", "."]:
                pos = line.rfind(sep, 32, 48)
                if pos > 0:
                    break_at = pos + 1
                    break
            display_lines.append(line[:break_at])
            line = line[break_at:]
        display_lines.append(line)

    y_cur = 90.5
    base_lh = 1.78
    inner_lh = 2.30

    in_section_12 = False

    for i, line in enumerate(display_lines):
        if y_cur < 1:
            break
        stripped = line.strip()

        is_heading = bool(re.match(r'^\d{1,2}[.、．]', stripped))
        if is_heading:
            in_section_12 = bool(re.match(r'^12[.、．]', stripped))
        is_conclusion = any(stripped.startswith(kw) for kw in ("【", "综合建议", "结论", "总结"))
        is_bold = is_heading or is_conclusion
        is_continuation = not is_bold and not (not stripped) and i > 0

        if not stripped:
            y_cur -= base_lh * 0.4
            continue

        text_color = "#c0392b" if in_section_12 else "#2c3e50"

        if is_bold:
            ax.text(1, y_cur, stripped, transform=ax.transData, fontsize=11.5,
                    color="#c0392b" if (is_conclusion or in_section_12) else "#000000",
                    ha="left", va="top", fontweight="bold")
            y_cur -= base_lh
        elif is_continuation:
            ax.text(2, y_cur, stripped, transform=ax.transData, fontsize=11,
                    color=text_color, ha="left", va="top")
            y_cur -= inner_lh
        else:
            ax.text(2, y_cur, stripped, transform=ax.transData, fontsize=11,
                    color=text_color, ha="left", va="top")
            y_cur -= base_lh


def _mark_signals(ax, df):
    """在价格图上标记金叉/死叉信号"""
    if len(df) < 21:
        return
    for i in range(20, len(df)):
        ma5_curr, ma5_prev = df["MA5"].iloc[i], df["MA5"].iloc[i - 1]
        ma20_curr, ma20_prev = df["MA20"].iloc[i], df["MA20"].iloc[i - 1]
        if pd.isna(ma5_curr) or pd.isna(ma20_curr) or pd.isna(ma5_prev) or pd.isna(ma20_prev):
            continue
        if ma5_prev <= ma20_prev and ma5_curr > ma20_curr:
            ax.scatter(df["time"].iloc[i], df["close"].iloc[i],
                       marker="^", color="#27ae60", s=60, zorder=5, edgecolors="white", linewidths=0.5)
        elif ma5_prev >= ma20_prev and ma5_curr < ma20_curr:
            ax.scatter(df["time"].iloc[i], df["close"].iloc[i],
                       marker="v", color="#e74c3c", s=60, zorder=5, edgecolors="white", linewidths=0.5)
