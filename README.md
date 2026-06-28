# CS2 Price Vault · 饰品分析终端

<p align="center">
  <img src="https://img.shields.io/badge/python-3.10+-blue" alt="Python">
  <img src="https://img.shields.io/badge/flask-3.0+-green" alt="Flask">
  <img src="https://img.shields.io/badge/license-MIT-brightgreen" alt="License">
</p>

一个面向 CS2 饰品投资者的桌面分析工具。接入悠悠有品 (csqaq.com) 实时价格数据，内置规则引擎 + DeepSeek AI 双轨分析，自动生成买卖建议。

**设计理念**：数字藏品画廊 × 精密金融工具。将传统技术分析 (MA/MACD/RSI/布林带/KDJ) 应用于 CS2 饰品市场，为短线交易和中长期持仓提供决策参考。

> 该项目最初为个人投资分析工具开发，现开源供 CS2 饰品交易者使用和改进。

## 功能

- **多维度技术分析** — 规则引擎 (评分制) + DeepSeek AI 多维度深度分析
- **提示词管理** — 4 类 AI 提示词可自定义模板，多模板切换，即时生效
- **交互式图表** — Plotly 交互式 K 线图 (可缩放/悬停) + matplotlib 静态图，一键切换
- **K线图可视化** — 价格走势 + 布林带 + RSI + MACD + KDJ + 在售数量
- **多轮对话追问** — 基于分析结果与 AI 深度讨论，支持 SSE 流式输出
- **自选列表** — 实时刷新价格、涨跌幅、在售数量
- **持仓管理** — 录入买入价/数量，计算浮动盈亏，AI 持仓建议
- **Steam 库存** — 绑定 Steam 库存链接，自动获取饰品列表、实时估值、总价值统计
- **大盘概览** — CS2 饰品市场指数、情绪、异动、涨跌分布
- **事件知识库** — CS2 相关事件记录，支持标签/日期/搜索和分页
- **历史记录** — 分析会话自动持久化，支持切换和回溯

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.10+, Flask, pandas, numpy |
| 前端 | Vanilla JS (ES6), CSS Custom Properties, 模块化拆分 (11 JS + 12 CSS) |
| 图表 | Plotly (交互式) + matplotlib (静态)，可在设置页切换 |
| AI | DeepSeek API (Chat Completions) |
| 数据源 | csqaq.com 开放 API + Steam 公开库存 |

## 快速开始

### 1. 克隆 & 安装

```bash
git clone https://github.com/<your-username>/cs2-price-vault.git
cd cs2-price-vault
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 API 密钥：

```ini
API_TOKEN="你的csqaq_api_token"          # 从 api.csqaq.com 获取
DEEPSEEK_API_KEY="sk-your_key_here"      # 从 platform.deepseek.com 获取
DEEPSEEK_MODEL="deepseek-v4-pro"          # 初次分析用的模型
DEEPSEEK_CHAT_MODEL="deepseek-v4-flash"  # 追问对话用的模型
AI_TEMPERATURE="0"
CHAT_TEMPERATURE="0"
```

> **获取 API Token**：访问 [api.csqaq.com](https://api.csqaq.com) 注册获取 token。首次使用需在设置页绑定当前 IP。

### 3. 启动

```bash
python app.py
```

浏览器将自动打开 `http://127.0.0.1:5000`。

## 使用说明

### 搜索与分析

1. 在左侧搜索框输入饰品名称（支持模糊搜索）
2. 选择分析周期（7天 ~ 2年）
3. 点击「开始分析」
4. 查看规则引擎评分、技术图表和 AI 分析报告

### AI 追问

分析完成后，在右侧对话框输入问题即可与 AI 深度讨论该饰品的走势和策略。

### 自选列表

点击「自选」标签，搜索并添加关注的饰品。点击刷新按钮获取最新价格。

### 持仓管理

点击「持仓」标签，录入买入价格和数量。系统自动计算浮动盈亏，并可为每个持仓请求 AI 操作建议。

### 提示词模板

点击「提示词」标签，可对 4 类 AI 提示词（分析系统角色、分析维度指令、追问系统角色、持仓建议模板）进行模板管理：每类可创建多个命名模板，通过下拉选择器即时切换，AI 分析/追问将使用当前激活的模板。

## 目录结构

```
cs2-price-vault/
├── app.py                     # Flask 主应用 (33 个路由)
├── core/
│   ├── config.py              # 配置加载 (.env)
│   ├── api_client.py          # csqaq.com API 封装
│   ├── steam_client.py        # Steam 公开库存 API
│   ├── indicators.py          # 技术指标计算
│   ├── recommendation.py      # 规则引擎 (-100~100 评分)
│   ├── ai_analysis.py         # DeepSeek AI 分析 & 多轮对话
│   ├── prompts.py             # 提示词管理器 (多模板+JSON持久化)
│   ├── visualization.py       # matplotlib 图表绘制
│   ├── visualization_plotly.py # Plotly 交互式图表
│   ├── id_map.py              # 饰品名称模糊搜索
│   └── utils.py               # 工具函数
├── templates/
│   ├── index.html             # 骨架模板 (Jinja2 {% include %})
│   └── partials/              # 12 个 HTML 模块 (head/header/sidebar/各页面/弹窗/设置)
├── static/
│   ├── js/                    # 11 个 JS 模块 (core→search→analysis→chat→settings→kb→prompts→dashboard→watchlist→inventory→init)
│   └── css/                   # 12 个 CSS 模块 (core/dashboard/analysis/watchlist/portfolio/settings/idmap/kb/prompts/inventory/responsive + style)
├── data/
│   └── 饰品id_20260423.json    # 饰品 ID 映射表 (~3.9MB)
├── prompts.json               # 提示词模板持久化 (自动生成)
├── knowledge_base.json        # 事件知识库持久化
├── watchlist.json             # 自选列表持久化
├── portfolio.json             # 持仓列表持久化
├── .env.example               # 环境变量模板
├── requirements.txt           # Python 依赖
└── LICENSE
```

## 常见问题

**Q: 为什么分析失败 / 数据获取不到？**

- 确认 `.env` 中 `API_TOKEN` 正确配置
- 在设置页面点击「绑定 IP」，确保当前 IP 在 csqaq 白名单中
- 免费 API 有频率限制，避免短时间内大量请求

**Q: AI 分析返回错误？**

- 确认 `DEEPSEEK_API_KEY` 有效且有可用余额
- 网络问题可能导致超时（已内置重试机制）
- 可以不配置 AI Key，系统仍会输出规则引擎分析

**Q: 图表中文显示为方块？**

- 确保系统安装了 SimHei 或 Microsoft YaHei 字体
- Linux 用户：`sudo apt install fonts-wqy-microhei`

## 免责声明

本项目仅供学习和研究使用。CS2 饰品市场属于高风险投资领域，**所有分析结果仅供参考，不构成任何投资建议**。AI 生成的建议可能不准确，请勿将其作为唯一决策依据。使用本工具产生的任何交易盈亏由使用者自行承担。

## License

MIT — 详见 [LICENSE](./LICENSE)
