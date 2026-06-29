# -*- coding: utf-8 -*-
"""核心分析 API"""

import os
import time
import uuid
from datetime import datetime
from flask import Blueprint, request, jsonify
import shared
from core.api_client import get_item_price_history, get_item_detail
from core.indicators import compute_indicators
from core.recommendation import generate_recommendation
from core.ai_analysis import get_ai_analysis
from core.visualization import plot_analysis
from core.visualization_plotly import plot_analysis as plot_analysis_plotly
from core.utils import extract_wear_level, sanitize_filename

analyze_bp = Blueprint("analyze", __name__)


@analyze_bp.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(force=True)
    item_id = data.get("item_id")
    period_days = data.get("period_days", 90)
    if not item_id:
        return jsonify({"error": "缺少 item_id"}), 400

    item_name = shared.id_to_name.get(int(item_id), f"ID:{item_id}")
    print(f"[分析] {item_name} (ID:{item_id}), {period_days}天")

    df = get_item_price_history(int(item_id), period_days)
    if df is None or df.empty:
        return jsonify({"error": f"获取 [{item_name}] 价格数据失败"}), 500

    print(f"  获取 {len(df)} 条价格数据")
    df = compute_indicators(df)
    recommendation = generate_recommendation(df)
    detail = get_item_detail(int(item_id)) or {}

    kb_entries = shared._load_kb()
    relevant_kb = shared.match_knowledge(item_name, kb_entries) if kb_entries else []
    ai_ok, ai_text = get_ai_analysis(df, item_name, period_days, recommendation, relevant_kb)
    if ai_ok is None:
        print(f"  AI 分析失败: {ai_text}")
    elif ai_ok is False:
        print(f"  AI 分析跳过: {ai_text[:80]}...")

    ui = shared._load_ui_settings()
    chart_engine = ui.get("chart_engine", "matplotlib")
    chart_html = ""

    if chart_engine == "plotly":
        plotly_fig = plot_analysis_plotly(df, item_name, period_days, recommendation, show=False)
        chart_b64 = shared._plotly_fig_to_base64(plotly_fig) if plotly_fig else ""
        if plotly_fig:
            try:
                chart_html = shared._build_chart_html_page(plotly_fig)
            except Exception as e:
                print(f"  生成 Plotly HTML 失败: {e}")
        if not chart_b64:
            print("  Plotly 回退到 matplotlib (kaleido 未安装)")
            plot_analysis(df, item_name, period_days, recommendation, show=False)
            chart_b64 = shared._fig_to_base64()
    else:
        plot_analysis(df, item_name, period_days, recommendation, show=False)
        chart_b64 = shared._fig_to_base64()

    # 保存图表到本地
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = sanitize_filename(item_name)
    wear = extract_wear_level(item_name)
    filename = f"{now_str}_{safe_name}"
    if wear:
        filename += f"_{wear}"
    filename += f"_{period_days}d_analysis"
    save_path = os.path.join(shared.BASE_DIR, "analysis_output", filename)
    try:
        if chart_engine == "plotly":
            save_path_png = save_path + ".png"
            plot_analysis_plotly(df, item_name, period_days, recommendation, save_path=save_path_png, show=False)
        else:
            save_path_png = save_path + ".png"
            import matplotlib.pyplot as plt
            plot_analysis(df, item_name, period_days, recommendation, show=False)
            plt.savefig(save_path_png, dpi=150, bbox_inches="tight")
            plt.close()
    except Exception as e:
        print(f"  保存图表失败: {e}")

    messages = None
    if ai_ok is True:
        try:
            messages = shared._build_chat_messages(df, item_name, period_days, recommendation, ai_text)
        except Exception as e:
            print(f"  构建对话历史失败: {e}")

    analysis_id = uuid.uuid4().hex[:10]
    user_data = shared._get_user_data()

    analysis_entry = {
        "id": analysis_id,
        "item_name": item_name,
        "item_id": int(item_id),
        "period_days": period_days,
        "chart_b64": chart_b64,
        "chart_html": chart_html,
        "recommendation": recommendation,
        "detail": detail,
        "ai_analysis": ai_text if (ai_ok is True or ai_ok is False) else "",
        "messages": messages,
        "created_at": time.time(),
    }

    with shared.SESSION_LOCK:
        user_data["analyses"][analysis_id] = analysis_entry
        user_data["active_id"] = analysis_id
        if len(user_data["analyses"]) > shared.MAX_ANALYSES_PER_USER:
            oldest = sorted(user_data["analyses"].values(), key=lambda a: a["created_at"])[0]
            del user_data["analyses"][oldest["id"]]
            shared._delete_analysis_from_disk(oldest["id"])

    shared._save_analysis_to_disk(analysis_entry)

    chat_msgs = messages[3:] if messages and len(messages) > 3 else []

    return jsonify({
        "analysis_id": analysis_id,
        "item_name": item_name,
        "item_id": int(item_id),
        "period_days": period_days,
        "chart_b64": chart_b64,
        "chart_html": chart_html,
        "recommendation": recommendation,
        "detail": detail,
        "ai_analysis": ai_text if (ai_ok is True or ai_ok is False) else "",
        "ai_error": ai_text if ai_ok is None else None,
        "can_chat": messages is not None,
        "chat_messages": chat_msgs,
    })
