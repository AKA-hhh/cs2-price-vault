# -*- coding: utf-8 -*-
"""API 数据获取 — 价格历史、K线、饰品详情"""

import json
import time
import requests
import pandas as pd
from datetime import datetime

from . import config  # 通过 config.XXX 引用，确保 _write_env_value 更新后读取最新值

# 请求间隔（秒），避免触发 429 频率限制
REQUEST_DELAY = 1.0
# 遇到 429 时最大重试次数
MAX_RETRIES_ON_429 = 3


def _api_request_with_retry(method, url, headers, data=None, json_payload=None, timeout=config.REQUEST_TIMEOUT):
    """带重试和频率控制的安全请求封装。

    1. 每次请求前 sleep REQUEST_DELAY 秒，确保不会连续轰炸 API
    2. 遇到 429 自动指数退避重试（1s / 2s / 4s）
    """
    time.sleep(REQUEST_DELAY)  # 请求间隔，防止短时间连续请求

    for attempt in range(MAX_RETRIES_ON_429 + 1):
        kwargs = {"headers": headers, "timeout": timeout}
        if data is not None:
            kwargs["data"] = data
        if json_payload is not None:
            kwargs["json"] = json_payload

        resp = requests.request(method, url, **kwargs)

        if resp.status_code == 429:
            wait = 2 ** attempt  # 1s, 2s, 4s
            print(f"  ⚠ 请求过于频繁 (429)，{wait}秒后重试 (第{attempt+1}次)...")
            time.sleep(wait)
            continue

        return resp

    # 全部重试失败，返回最后一次的 429 响应
    return resp


def get_item_price_history(item_id, period_days):
    """获取饰品历史价格数据。

    首选 K线端点 (/api/v1/sub/kline)，返回完整 OHLC，
    若不可用则回退到普通价格端点 (/api/v1/info/chart)。
    """
    kline_data = _try_kline_api(item_id, period_days)
    if kline_data is not None:
        return kline_data

    print("K线端点不可用，使用普通价格端点...")
    df, _raw = _try_chart_api(item_id, period_days)
    return df


def _try_kline_api(item_id, period_days):
    """尝试 K线端点 POST /api/v1/info/simple/chartAll (返回 OHLC K线数据)

    接口文档: https://api.csqaq.com → 获取单件饰品图表数据(K线)

    参数说明:
      good_id  - 饰品唯一ID（整数）
      plat     - 平台: 1=BUFF  2=悠悠有品
      periods  - K线粒度: 1hour / 4hour / 1day
      max_time - 数据截止时间戳（毫秒），传当前时间即可

    返回: [{c(收盘), h(最高), l(最低), o(开盘), t(时间戳ms), v(成交量)}]

    根据 period_days 自动选择 K 线粒度:
      - <=7 天  → 1hour (小时线)
      - <=30 天 → 4hour (4小时线)
      - >30 天  → 1day  (日线)

    注意: 此端点需企业IP权限，个人用户会返回 401，届时自动回退到 chart 端点。
    """
    if period_days <= 7:
        ktype = "1hour"
    elif period_days <= 30:
        ktype = "4hour"
    else:
        ktype = "1day"

    url = "https://api.csqaq.com/api/v1/info/simple/chartAll"
    payload = json.dumps({
        "good_id": str(item_id),
        "plat": 1,
        "periods": ktype,
        "max_time": int(time.time() * 1000),
    })
    headers = {"ApiToken": config.API_TOKEN, "Content-Type": "application/json"}
    print(f"  请求K线: {ktype} (period={period_days}d)")

    try:
        resp = _api_request_with_retry("POST", url, headers, data=payload.encode("utf-8"))
        if resp.status_code == 401:
            print(f"  K线端点 401: API Token 无效或未绑定IP")
            return None
        if resp.status_code == 429:
            print("  K线端点 429: 被限流，跳过")
            return None
        if resp.status_code != 200:
            print(f"  K线端点 HTTP {resp.status_code}，回退普通端点")
            return None

        data = resp.json()
        code = data.get("code", -1)
        if code != 200:
            print(f"  K线端点业务错误: code={code}, msg={data.get('msg', '')}")
            return None

        raw = data.get("data", [])
        if not raw:
            print("  K线端点返回空 data 数组")
            return None

        print(f"  K线端点原始返回 {len(raw)} 条 (类型={ktype})")
        # 调试：打印第一条数据看看格式
        if len(raw) > 0:
            sample = raw[0]
            if isinstance(sample, dict):
                print(f"  数据格式: dict, keys={list(sample.keys())}, sample={ {k: sample[k] for k in list(sample.keys())[:6]} }")
            elif isinstance(sample, (list, tuple)):
                print(f"  数据格式: list(len={len(sample)}), sample={sample[:6]}")
            else:
                print(f"  数据格式: {type(sample).__name__}, sample={str(sample)[:100]}")

        df = _parse_kline(raw)
        if df is None or df.empty:
            print("  K线端点: 解析后无有效数据")
            return None

        print(f"[K线端点] 成功获取 {len(df)} 条 K线, columns={list(df.columns)}, {df['time'].iloc[0]} ~ {df['time'].iloc[-1]}")
        return df
    except Exception as e:
        print(f"  K线端点异常: {e}")
        return None


def _parse_kline(raw_data):
    """解析K线数据 → DataFrame (columns: time, open, high, low, close, volume)"""
    records = []
    for item in raw_data:
        if isinstance(item, dict):
            ts = item.get("t", item.get("timestamp", item.get("time", 0)))
            o = item.get("o", item.get("open"))
            h = item.get("h", item.get("high"))
            l = item.get("l", item.get("low"))
            c = item.get("c", item.get("close"))
            v = item.get("v", item.get("volume", item.get("vol", 0)))
        elif isinstance(item, (list, tuple)):
            ts = item[0] if len(item) > 0 else 0
            o = item[1] if len(item) > 1 else None
            h = item[2] if len(item) > 2 else None
            l = item[3] if len(item) > 3 else None
            c = item[4] if len(item) > 4 else None
            v = item[5] if len(item) > 5 else 0
        elif isinstance(item, str):
            try:
                item = json.loads(item)
                ts = item.get("t", item.get("timestamp", 0))
                o = item.get("o", item.get("open"))
                h = item.get("h", item.get("high"))
                l = item.get("l", item.get("low"))
                c = item.get("c", item.get("close"))
                v = item.get("v", item.get("volume", item.get("vol", 0)))
            except json.JSONDecodeError:
                continue
        else:
            continue

        if c is None:
            continue

        if isinstance(ts, str):
            ts = int(ts) if ts.isdigit() else float(ts)
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts)
        else:
            dt = ts

        records.append({
            "time": dt,
            "open": float(o) if o is not None else float(c),
            "high": float(h) if h is not None else float(c),
            "low": float(l) if l is not None else float(c),
            "close": float(c),
            "volume": float(v) if v else 0,
        })

    if not records:
        return None
    df = pd.DataFrame(records)
    df.sort_values("time", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def _try_chart_api(item_id, period_days):
    """使用 /api/v1/info/chart 获取价格数据（含在售数量）

    接口文档: https://api.csqaq.com → 饰品详情 → 获取单件饰品图表数据

    参数说明:
      good_id  - 饰品唯一ID（整数）
      key      - 数据类型: sell_price(出售价) / buy_price(求购价) / sell_num(在售数量) 等
                 lease_num / short_lease_price / long_lease_price 等仅限 platform=2
                 turnover_number 仅限 platform=3
      platform - 平台: 1=BUFF  2=悠悠有品  3=Steam  4=C5GAME
      period   - 查询周期: 7/15/30/90/180/365/1095 (天)
      style    - 款式: all_style(默认) / Phase1~4 / Sapphire / Ruby / Black Pearl / Emerald
                 (仅 platform=1 查询多普勒系列时可用)
    """
    # 将用户选择的周期映射到 API 支持的有效值
    VALID_PERIODS = [7, 15, 30, 90, 180, 365, 1095]
    api_period = min(VALID_PERIODS, key=lambda p: abs(p - period_days))

    url = "https://api.csqaq.com/api/v1/info/chart"
    headers = {"ApiToken": config.API_TOKEN, "Content-Type": "application/json"}
    payload = json.dumps({
        "good_id": str(item_id),
        "key": "sell_price",       # 出售价（含在售数量 num_data）
        "platform": 2,             # 2 = 悠悠有品
        "period": str(api_period), # 最近 N 天
        "style": "all_style",      # 默认款式
    })

    try:
        resp = _api_request_with_retry("POST", url, headers, data=payload.encode("utf-8"))
        print(f"HTTP状态码: {resp.status_code}")

        if resp.status_code == 401:
            print("错误: API Token 无效或未绑定当前IP")
            return None, None
        if resp.status_code == 429:
            print("错误: 请求过于频繁，请稍后再试")
            return None, None
        if resp.status_code != 200:
            print(f"错误: HTTP {resp.status_code}")
            return None, None

        data = resp.json()
        if data.get("code") != 200:
            print(f"业务错误: code={data.get('code')}, msg={data.get('msg')}")
            return None, None

        raw = data.get("data")
        if not raw or not isinstance(raw, dict):
            print("提示: 返回数据为空或格式异常")
            return None, None

        timestamps = raw.get("timestamp", [])
        prices = raw.get("main_data", [])
        sell_nums = raw.get("num_data", [])

        if not timestamps or not prices:
            print("提示: 该饰品暂无历史数据")
            return None, None

        records = []
        for i, (ts, price) in enumerate(zip(timestamps, prices)):
            dt = datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts)
            rec = {"time": dt, "close": float(price)}
            if i < len(sell_nums) and sell_nums[i] is not None:
                rec["sell_num"] = int(sell_nums[i])
            else:
                rec["sell_num"] = 0
            records.append(rec)

        df = pd.DataFrame(records)
        print(f"获取 {len(df)} 条价格记录")
        return df, raw

    except requests.exceptions.RequestException as e:
        print(f"网络请求异常: {e}")
        return None, None
    except Exception as e:
        print(f"数据处理异常: {e}")
        return None, None


def get_item_detail(item_id):
    """获取单件饰品详细信息（含磨损度、涨跌统计等）

    接口: GET /api/v1/info/good?id=X
    返回 goods_info 字典，失败返回 None
    """
    url = f"https://api.csqaq.com/api/v1/info/good?id={item_id}"
    headers = {"ApiToken": config.API_TOKEN}
    try:
        resp = _api_request_with_retry("GET", url, headers)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("code") != 200:
            return None
        return data["data"].get("goods_info", {})
    except Exception:
        return None


def get_market_overview():
    """获取大盘概览数据（指数、情绪、异动、涨跌分布等）

    接口: GET /api/v1/current_data?type=init
    返回完整 data dict，失败返回 None
    """
    url = "https://api.csqaq.com/api/v1/current_data?type=init"
    headers = {"ApiToken": config.API_TOKEN}
    try:
        resp = _api_request_with_retry("GET", url, headers)
        if resp.status_code != 200:
            print(f"大盘数据请求失败: HTTP {resp.status_code}")
            return None
        data = resp.json()
        if data.get("code") != 200:
            print(f"大盘数据业务错误: code={data.get('code')}")
            return None
        return data.get("data")
    except Exception as e:
        print(f"大盘数据异常: {e}")
        return None
