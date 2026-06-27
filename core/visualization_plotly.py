# -*- coding: utf-8 -*-
"""可视化 — Plotly 交互式图表 (K线+成交量+RSI+MACD+KDJ)"""

import os
import numpy as np
import pandas as pd
from datetime import timedelta
import plotly.graph_objects as go
from plotly.subplots import make_subplots


def _has_col(df, col):
    return col in df.columns and df[col].notna().any()


def plot_analysis(df, item_name, period_days, recommendation, save_path=None, show=True):
    """用 Plotly 绘制交互式 K 线分析图（多子图：价格+成交量+RSI+MACD+KDJ）"""
    n = len(df)
    if n < 2:
        print("数据点不足，无法绘图")
        return None

    df = df.copy()

    # 下采样：超过 MAX_POINTS 条时按时间聚合，保证渲染性能
    # 折线图轻量可以放更多点，K线图超过这个数也会触发聚合
    MAX_POINTS = 600
    if n > MAX_POINTS:
        df = df.set_index("time")
        df.index = pd.to_datetime(df.index)
        freq = max(1, n // MAX_POINTS)
        # 构建聚合规则：均值列用 last，数量列用 sum
        agg = {}
        for col in df.columns:
            if col in ("sell_num", "volume"):
                agg[col] = "sum"
            else:
                agg[col] = "last"
        df = df.resample(f"{freq}D").agg(agg).dropna(how="all").reset_index()
        print(f"  图表下采样: {n} → {len(df)} 条 (每 {freq} 天聚合)")

    # 确保 time 列是 Python datetime (kaleido 序列化要求)
    if "time" in df.columns and hasattr(df["time"], "dt"):
        df["time"] = df["time"].dt.to_pydatetime()

    has_sellnum = "sell_num" in df.columns and df["sell_num"].sum() > 0
    has_kdj = _has_col(df, "KDJ_K")
    has_bb = _has_col(df, "BB_Up")
    has_macd = _has_col(df, "MACD_Hist")

    # ------- 动态子图布局 -------
    rows = 2  # K线 + 成交量
    row_heights = [0.48, 0.14]
    specs = [[{"secondary_y": False}], [{"secondary_y": False}]]

    # RSI
    rows += 1
    row_heights.append(0.11)
    specs.append([{"secondary_y": False}])

    # MACD
    rows += 1
    row_heights.append(0.11)
    specs.append([{"secondary_y": False}])

    # KDJ
    if has_kdj:
        rows += 1
        row_heights.append(0.10)
        specs.append([{"secondary_y": False}])

    fig = make_subplots(
        rows=rows,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.03,
        row_heights=row_heights,
        specs=specs,
    )

    # ═══════════════════ 1. K线图 ═══════════════════
    has_ohlc = all(c in df.columns for c in ["open", "high", "low"])
    use_kline = has_ohlc

    if use_kline:
        fig.add_trace(
            go.Candlestick(
                x=df["time"],
                open=df["open"],
                high=df["high"],
                low=df["low"],
                close=df["close"],
                name="K线",
                increasing=dict(line=dict(color="#e74c3c"), fillcolor="#e74c3c"),
                decreasing=dict(line=dict(color="#27ae60"), fillcolor="#27ae60"),
                showlegend=True,
            ),
            row=1,
            col=1,
        )
    else:
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["close"],
                mode="lines",
                name="收盘价",
                line=dict(color="#1a1a2e", width=1.2),
                fill="tozeroy",
                fillcolor="rgba(26,26,46,0.06)",
            ),
            row=1,
            col=1,
        )

    # 均线
    ma_configs = [
        ("MA5", "#e74c3c"),
        ("MA10", "#e67e22"),
        ("MA20", "#2ecc71"),
        ("MA60", "#9b59b6"),
    ]
    for ma_name, ma_color in ma_configs:
        if _has_col(df, ma_name):
            fig.add_trace(
                go.Scatter(
                    x=df["time"],
                    y=df[ma_name],
                    mode="lines",
                    name=ma_name,
                    line=dict(color=ma_color, width=0.8, dash="dash"),
                    opacity=0.85,
                ),
                row=1,
                col=1,
            )

    # 布林带
    if has_bb:
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["BB_Up"],
                mode="lines",
                name="BB_Up",
                line=dict(color="#3498db", width=0.5),
                showlegend=False,
            ),
            row=1,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["BB_Low"],
                mode="lines",
                name="布林带 (±2σ)",
                line=dict(color="#3498db", width=0.5),
                fill="tonexty",
                fillcolor="rgba(52,152,219,0.08)",
                showlegend=True,
            ),
            row=1,
            col=1,
        )

    # 金叉/死叉标记
    _add_signal_markers(fig, df, row=1, col=1)

    # ═══════════════════ 2. 在售数量 / 成交量 ═══════════════════
    if has_sellnum:
        # 根据涨跌着色：有 OHLC 用 open/close，否则用 close.diff()
        if has_ohlc:
            colors = [
                "#e74c3c" if close >= open_ else "#27ae60"
                for close, open_ in zip(df["close"], df["open"])
            ]
        else:
            up = df["close"].diff() >= 0
            colors = ["#e74c3c" if u else "#27ae60" for u in up]
        fig.add_trace(
            go.Bar(
                x=df["time"],
                y=df["sell_num"],
                name="在售数量",
                marker_color=colors,
                opacity=0.65,
                showlegend=True,
            ),
            row=2,
            col=1,
        )
        if _has_col(df, "SellNum_MA5"):
            fig.add_trace(
                go.Scatter(
                    x=df["time"],
                    y=df["SellNum_MA5"],
                    mode="lines",
                    name="在售MA5",
                    line=dict(color="#f39c12", width=0.8),
                ),
                row=2,
                col=1,
            )
    else:
        # 无数据提示
        fig.add_annotation(
            xref="x domain",
            yref="y domain",
            x=0.5,
            y=0.5,
            text="无在售数据",
            showarrow=False,
            font=dict(color="#bdc3c7", size=12),
            row=2,
            col=1,
        )

    # ═══════════════════ 3. RSI ═══════════════════
    if _has_col(df, "RSI"):
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["RSI"],
                mode="lines",
                name="RSI",
                line=dict(color="#8e44ad", width=1),
                showlegend=True,
            ),
            row=3,
            col=1,
        )
    fig.add_hline(y=70, line_dash="dash", line_color="#e74c3c", opacity=0.5, row=3, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="#27ae60", opacity=0.5, row=3, col=1)
    fig.update_yaxes(range=[0, 100], row=3, col=1)

    # ═══════════════════ 4. MACD ═══════════════════
    macd_row = 4
    if has_macd:
        macd_colors = [
            "#e74c3c" if v >= 0 else "#27ae60" for v in df["MACD_Hist"]
        ]
        # 根据数据量自动计算柱宽，点越多柱子越细 —— 用中位时间间隔防止不可见
        n_macd = len(df)
        if n_macd >= 2:
            diffs = (df["time"].diff().dropna().dt.total_seconds() * 1000).abs()  # ms
            median_gap = diffs.median() if len(diffs) > 0 else 86400000
            bar_w = max(median_gap * 0.85, 3600000)  # 最少 1 小时宽度，防止柱子过细不可见
        else:
            bar_w = None  # 让 Plotly 自己决定
        fig.add_trace(
            go.Bar(
                x=df["time"],
                y=df["MACD_Hist"],
                name="MACD柱",
                marker=dict(
                    color=macd_colors,
                    line=dict(color="rgba(255,255,255,0.5)", width=0.6),
                ),
                opacity=0.85,
                width=bar_w,
                showlegend=True,
            ),
            row=macd_row,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["MACD"],
                mode="lines",
                name="MACD",
                line=dict(color="#2c3e50", width=0.8),
            ),
            row=macd_row,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["MACD_Signal"],
                mode="lines",
                name="Signal",
                line=dict(color="#e67e22", width=0.8),
            ),
            row=macd_row,
            col=1,
        )
    fig.add_hline(y=0, line_color="#7f8c8d", line_width=0.5, row=macd_row, col=1)

    # ═══════════════════ 5. KDJ ═══════════════════
    if has_kdj:
        kdj_row = 5
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["KDJ_K"],
                mode="lines",
                name="K",
                line=dict(color="#e74c3c", width=0.8),
            ),
            row=kdj_row,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["KDJ_D"],
                mode="lines",
                name="D",
                line=dict(color="#27ae60", width=0.8),
            ),
            row=kdj_row,
            col=1,
        )
        fig.add_trace(
            go.Scatter(
                x=df["time"],
                y=df["KDJ_J"],
                mode="lines",
                name="J",
                line=dict(color="#8e44ad", width=0.8),
            ),
            row=kdj_row,
            col=1,
        )
        fig.add_hline(y=80, line_dash="dash", line_color="#e74c3c", opacity=0.3, row=kdj_row, col=1)
        fig.add_hline(y=20, line_dash="dash", line_color="#27ae60", opacity=0.3, row=kdj_row, col=1)

    # ═══════════════════ 全局布局 ═══════════════════
    fig.update_layout(
        title=dict(
            text=f"{item_name} — 近{period_days}天K线图 (悠悠有品)",
            font=dict(size=13),
            x=0.01,
            y=0.995,
            xanchor="left",
            yanchor="top",
        ),
        height=220 * rows,
        hovermode="x unified",
        template="plotly_white",
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.005,
            xanchor="left",
            x=0,
            font=dict(size=9),
        ),
        margin=dict(l=40, r=20, t=20, b=20),
        font=dict(family="Microsoft YaHei, SimHei, sans-serif"),
    )

    # 隐藏所有子图的 rangeslider
    fig.update_xaxes(rangeslider_visible=False)

    # 收紧 x 轴范围：移除 Plotly 默认的 ~5% 留白
    t_min, t_max = df["time"].min(), df["time"].max()
    if t_min != t_max:
        padding = timedelta(seconds=(t_max - t_min).total_seconds() * 0.01)  # 1% 留白
        fig.update_xaxes(range=[t_min - padding, t_max + padding])

    # 最后一个子图显示日期标签
    last_row = rows
    fig.update_xaxes(row=last_row, col=1, tickformat="%m-%d", dtick="auto")

    # ═══════════════════ 保存 / 显示 ═══════════════════
    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        try:
            fig.write_image(save_path, format="png", scale=2)
            print(f"走势图已保存至: {save_path}")
        except ValueError as e:
            # kaleido 未安装时，回退到写 HTML
            print(f"PNG 导出失败 (需安装 kaleido): {e}")
            html_path = save_path.rsplit(".", 1)[0] + ".html"
            fig.write_html(html_path, include_plotlyjs="cdn", full_html=True)
            print(f"交互式图表已保存至: {html_path}")

    if show:
        fig.show()

    # 返回 save_path (如果有)，否则返回 figure 对象 (供调用方转 base64)
    return save_path if save_path else fig


def fig_to_html(fig=None, include_plotlyjs="cdn"):
    """将 Plotly figure 转为可嵌入的 HTML 片段"""
    if fig is None:
        return ""
    return fig.to_html(include_plotlyjs=include_plotlyjs, full_html=False)


def _add_signal_markers(fig, df, row=1, col=1):
    """在 K 线图上标记金叉/死叉信号"""
    if len(df) < 21:
        return
    for i in range(20, len(df)):
        ma5_curr = df["MA5"].iloc[i]
        ma5_prev = df["MA5"].iloc[i - 1]
        ma20_curr = df["MA20"].iloc[i]
        ma20_prev = df["MA20"].iloc[i - 1]
        if any(pd.isna(v) for v in [ma5_curr, ma20_curr, ma5_prev, ma20_prev]):
            continue

        # 安全获取时间字符串
        t_val = df["time"].iloc[i]
        if hasattr(t_val, "strftime"):
            date_str = t_val.strftime("%Y-%m-%d")
        else:
            date_str = str(t_val)[:10]

        if ma5_prev <= ma20_prev and ma5_curr > ma20_curr:
            # 金叉
            fig.add_trace(
                go.Scatter(
                    x=[t_val],
                    y=[df["close"].iloc[i]],
                    mode="markers",
                    marker=dict(symbol="triangle-up", color="#27ae60", size=10, line=dict(color="white", width=1)),
                    name="金叉",
                    showlegend=False,
                    hovertext=f"金叉<br>日期: {date_str}<br>价格: ¥{df['close'].iloc[i]:.2f}",
                ),
                row=row,
                col=col,
            )
        elif ma5_prev >= ma20_prev and ma5_curr < ma20_curr:
            # 死叉
            fig.add_trace(
                go.Scatter(
                    x=[t_val],
                    y=[df["close"].iloc[i]],
                    mode="markers",
                    marker=dict(symbol="triangle-down", color="#e74c3c", size=10, line=dict(color="white", width=1)),
                    name="死叉",
                    showlegend=False,
                    hovertext=f"死叉<br>日期: {date_str}<br>价格: ¥{df['close'].iloc[i]:.2f}",
                ),
                row=row,
                col=col,
            )
