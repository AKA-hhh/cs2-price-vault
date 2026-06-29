# -*- coding: utf-8 -*-
"""
CS2 饰品价格分析桌面应用 — Flask 后端 v2.0
支持多会话历史侧边栏 / 模块化蓝图架构
"""

import os
import sys
import threading

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from flask import Flask, render_template
from core.config import PERIOD_PRESETS
from shared import init_shared_state

# ── 创建应用 ──
app = Flask(__name__)
app.secret_key = os.urandom(24).hex()
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# ── 初始化共享状态 (ID映射、库存缓存、分析历史) ──
init_shared_state()

# ── 注册蓝图 ──
from routes.search import search_bp
from routes.watchlist import watchlist_bp
from routes.portfolio import portfolio_bp
from routes.inventory import inventory_bp
from routes.rank import rank_bp
from routes.analyze import analyze_bp
from routes.chat import chat_bp
from routes.sessions import sessions_bp
from routes.settings import settings_bp
from routes.knowledge import knowledge_bp
from routes.prompts import prompts_bp

app.register_blueprint(search_bp)
app.register_blueprint(watchlist_bp)
app.register_blueprint(portfolio_bp)
app.register_blueprint(inventory_bp)
app.register_blueprint(rank_bp)
app.register_blueprint(analyze_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(sessions_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(knowledge_bp)
app.register_blueprint(prompts_bp)


@app.route("/")
def index():
    return render_template("index.html", period_presets=PERIOD_PRESETS)


# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import webbrowser
    host, port = "127.0.0.1", 5000

    print(f"\n{'='*50}")
    print(f"  CS2 饰品价格分析桌面应用 v2.0")
    print(f"  http://{host}:{port}")
    print(f"{'='*50}\n")

    threading.Timer(1.0, lambda: webbrowser.open(f"http://{host}:{port}")).start()
    app.run(host=host, port=port, debug=False)
