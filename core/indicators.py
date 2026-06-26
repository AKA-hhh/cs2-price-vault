# -*- coding: utf-8 -*-
"""技术指标计算 — MA, RSI, MACD, 布林带, KDJ, 动量, 波动率"""

import numpy as np
import pandas as pd


def compute_indicators(df):
    """计算技术指标并追加到 DataFrame"""
    close = df["close"].values
    if len(close) < 5:
        return df

    # 移动平均线
    df["MA5"] = df["close"].rolling(5).mean()
    df["MA10"] = df["close"].rolling(10).mean()
    df["MA20"] = df["close"].rolling(20).mean()
    df["MA60"] = df["close"].rolling(60).mean()

    # RSI (14)
    delta = np.diff(close, prepend=close[0])
    gain = np.maximum(delta, 0)
    loss = np.maximum(-delta, 0)
    avg_gain = pd.Series(gain).rolling(14).mean()
    avg_loss = pd.Series(loss).rolling(14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["RSI"] = 100.0 - (100.0 / (1.0 + rs))

    # MACD
    ema12 = df["close"].ewm(span=12, adjust=False).mean()
    ema26 = df["close"].ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["MACD_Hist"] = df["MACD"] - df["MACD_Signal"]

    # 布林带 (20, 2)
    df["BB_Mid"] = df["close"].rolling(20).mean()
    bb_std = df["close"].rolling(20).std()
    df["BB_Up"] = df["BB_Mid"] + 2 * bb_std
    df["BB_Low"] = df["BB_Mid"] - 2 * bb_std

    # 动量 (5日涨跌幅 %)
    df["Momentum"] = df["close"].pct_change(5) * 100

    # 波动率 (20日)
    df["Volatility"] = df["close"].pct_change().rolling(20).std() * 100

    # KDJ (9, 3, 3)
    n = 9
    low_n = df["close"].rolling(n).min()
    high_n = df["close"].rolling(n).max()
    rsv = ((df["close"] - low_n) / (high_n - low_n).replace(0, np.nan)) * 100
    rsv = rsv.fillna(50)
    k_list, d_list = [], []
    k_prev, d_prev = 50.0, 50.0
    for r in rsv:
        if pd.isna(r):
            k_list.append(k_prev)
            d_list.append(d_prev)
        else:
            k = 2/3 * k_prev + 1/3 * r
            d = 2/3 * d_prev + 1/3 * k
            k_list.append(k)
            d_list.append(d)
            k_prev, d_prev = k, d
    df["KDJ_K"] = k_list
    df["KDJ_D"] = d_list
    df["KDJ_J"] = 3 * df["KDJ_K"] - 2 * df["KDJ_D"]

    # 在售数量均线
    if "sell_num" in df.columns and df["sell_num"].sum() > 0:
        df["SellNum_MA5"] = df["sell_num"].rolling(5).mean()

    return df
