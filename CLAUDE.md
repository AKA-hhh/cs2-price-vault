# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CS2 饰品价格分析桌面应用 — Flask 后端 + 原生 JS 前端的单页应用 (SPA)。接入 csqaq.com K线/价格 API 和 DeepSeek AI，对 CS2 饰品做技术分析并生成买卖建议。面向中文用户。

## How to run

```bash
pip install -r requirements.txt
cp .env.example .env   # 然后填入 API 密钥
python app.py          # → http://127.0.0.1:5000，自动打开浏览器
```

无测试、无 lint、无构建步骤。服务器 `debug=False`，改代码需手动重启。

## Architecture

```
app.py                   # Flask 单文件服务器 (33 个路由: 搜索/分析/追问/自选/持仓/设置/提示词CRUD)
core/
  config.py              # dotenv 加载，常量定义 (API keys、周期预设、超时)
  api_client.py          # csqaq.com API: K线端点优先，回退 chart 端点，内置 429 重试+间隔
  indicators.py          # pandas 技术指标: MA5/10/20/60, RSI, MACD, 布林带, KDJ, 动量, 波动率
  recommendation.py      # 规则引擎: 7 维度加权评分 (-100~100)，输出 buy/hold/sell
  ai_analysis.py         # DeepSeek API: 通过 prompt_mgr 获取提示词模板，12 维度初次分析 + 多轮追问
  prompts.py             # 提示词管理器单例: 多模板数据模型、JSON 持久化、CRUD、旧格式自动迁移
  visualization.py       # matplotlib 图表: K线/收盘线 + 成交量 + RSI + MACD + KDJ 子图
  visualization_plotly.py # Plotly 交互式图表 (替代 matplotlib，可在设置页切换)
  id_map.py              # 饰品名称模糊搜索: 子串匹配优先 → difflib 补充
  utils.py               # 磨损度提取、文件名清理、CSV 保存
templates/
  index.html             # 骨架模板，使用 Jinja2 {% include %} 引入 partials/
  partials/
    head.html            # <head>: meta、字体、CSS links (11 个文件)
    header.html          # 顶部状态栏
    sidebar.html         # 搜索框、周期选择、历史列表
    page_dashboard.html  # 大盘仪表盘
    page_watchlist.html  # 自选页
    page_kb.html         # 事件知识库
    page_prompts.html    # 提示词管理 (2×2 卡片)
    page_inventory.html  # Steam 库存页
    page_loading.html    # 分析加载动画 + 错误提示
    page_results.html    # 分析结果 (图表、建议、详情、AI 对话)
    modals.html          # 所有弹窗 (库存绑定、提示词管理、KB查看/编辑、图片查看、ID Map、确认框)
    settings.html        # 设置抽屉
static/js/               # 按功能模块拆分的 11 个 JS 文件，<script> 标签顺序 = 依赖顺序
  core.js                # DOM refs、全局状态、工具函数 (show/hide/fmtNum/escHtml/simpleMD/typewriterEffect/confirm/toast)
  search.js              # loadHistory、renderHistory、doSearch、周期选择器
  analysis.js            # 页面导航、runAnalysis、renderResults、renderGauge、renderActionBadge
  chat.js                # sendChat、appendMsg、聊天事件
  settings.js            # 设置抽屉：主题/强调色/API密钥/模型/ID Map上传
  kb.js                  # 事件知识库：列表+分页、CRUD 弹窗
  prompts.js             # 提示词管理：卡片渲染、模板管理器弹窗
  dashboard.js           # 大盘仪表盘：指数列表、涨跌榜
  watchlist.js           # 自选列表：表格渲染、价格刷新
  inventory.js           # Steam 库存：获取库存、价格刷新、成本编辑、筛选排序
  init.js                # 自动刷新定时器、图片查看器、页面初始化入口 (最后加载)
static/css/              # 按功能模块拆分的 12 个 CSS 文件，<link> 标签并行加载
  core.css               # 设计 token、基础样式、顶栏、侧边栏、面板系统、按钮、强调色、暗/亮主题
  dashboard.css          # 大盘仪表盘
  analysis.css           # 分析结果页：图表、仪表盘、信号、详情、AI 文本、聊天
  watchlist.css          # 自选页表格
  portfolio.css          # 持仓页：汇总、表格、弹窗
  settings.css           # 设置抽屉
  idmap.css              # ID Map 预览弹窗 + 分页
  kb.css                 # 知识库卡片网格 + 分页 + 编辑/查看弹窗
  prompts.css            # 提示词 2×2 卡片 + 模板管理器弹窗
  inventory.css          # 库存表格、筛选器、磨损标签、排序
  responsive.css         # 响应式断点
  style.css              # 汇总文件 (保留为空，可改用 @import)
data/饰品id_20260423.json   # ~3.9MB, 39000+ 条饰品 ID→名称映射
prompts.json               # 提示词模板持久化 (自动生成，4 类: 分析system/分析指令/追问system/持仓建议)
knowledge_base.json        # 事件知识库持久化
inventory.json             # 库存缓存持久化
inventory_binding.json     # Steam 库存绑定信息
```

## Key data flow

1. **搜索**: `POST /api/search` → `id_map.search_item()` 模糊匹配
2. **分析**: `POST /api/analyze` →
   `api_client.get_item_price_history()` → `indicators.compute_indicators()` →
   `recommendation.generate_recommendation()` → `ai_analysis.get_ai_analysis()` →
   `visualization.plot_analysis()` → base64 PNG 返回 + 磁盘持久化
3. **追问**: `POST /api/chat` (非流式) / `POST /api/chat/stream` (SSE) — 追加到对话历史
4. **品类更新**: `POST /api/settings/id-map/upload` — 验证 JSON → 备份旧文件 → 写入 → 重建内存映射，失败自动回滚

## Prompt management (提示词管理)

4 类 AI 提示词可从提示词页面编辑，每类支持多个命名模板，通过下拉选择器切换当前使用的模板：

| Key | 用途 | 使用位置 |
|-----|------|---------|
| `analysis_system` | AI 分析时的角色设定 | `ai_analysis.get_ai_analysis()` system prompt |
| `analysis_instruction` | 分析维度框架和输出格式 | `ai_analysis._build_ai_prompt()` 结尾 |
| `chat_system` | 追问对话的角色设定 | `app._build_chat_messages()` system prompt |
| `portfolio_advice` | 持仓 AI 建议模板 | `app.api_portfolio_advice()` `.format()` 替换 |

数据模型 (`prompts.json`):
```json
{
  "analysis_system": {
    "label": "分析 System Prompt",
    "desc": "设定 AI 在初次技术分析时的角色和行为准则。",
    "active_id": "default",
    "items": [
      {"id": "default", "name": "默认", "text": "...", "builtin": true},
      {"id": "a1b2c3", "name": "自定义模板", "text": "...", "builtin": false}
    ]
  }
}
```

API 路由:
- `GET  /api/prompts` — 获取全部模板数据
- `PUT  /api/prompts/<key>/active` — 切换激活模板 `{id: tid}`
- `POST /api/prompts/<key>/templates` — 新建模板 `{name, text}`
- `PUT  /api/prompts/<key>/templates/<tid>` — 更新模板 `{name?, text?}`
- `DELETE /api/prompts/<key>/templates/<tid>` — 删除模板（builtin 不可删）

⚠️ **注意**: `ai_analysis.py` 中 system prompt 的 content 必须是纯字符串，不能有多余的括号和逗号，否则 Python 会解析为 tuple，DeepSeek API 返回 400。

## External APIs

- **csqaq.com** (`API_TOKEN`): K线 `/api/v1/info/simple/chartAll`、价格 `/api/v1/info/chart`、详情 `/api/v1/info/good`、大盘 `/api/v1/current_data?type=init`。请求间 1s 间隔，429 指数退避重试 (1s/2s/4s)。
- **DeepSeek** (`DEEPSEEK_API_KEY`): 双模型 — `DEEPSEEK_MODEL` 做分析 (默认 v4-pro)、`DEEPSEEK_CHAT_MODEL` 做追问 (默认 v4-flash)，可在设置页切换。

## State & persistence

- ID 映射: 启动时从 `data/饰品id_*.json` 加载到内存全局变量，运行时可通过设置页上传替换并即时更新
- 分析历史: 内存 `user_sessions["_local_"]` + `history/{aid}.json` + `history/{aid}.png`，启动恢复，最多 50 条
- 自选/持仓: `watchlist.json`、`portfolio.json` 扁平文件，每次请求读写
- 设置: API 密钥 → `.env`；UI 偏好 → `settings.json`
- 提示词: `prompts.json`，启动加载到 `PromptManager` 单例，每次 CRUD 操作即时持久化

## Naming conventions

- 中文注释、中文 UI、中文变量名 (`name_to_id`, `market_to_id`)
- matplotlib 用 SimHei/Microsoft YaHei 字体，Agg 后端
- 分析 ID: `uuid.uuid4().hex[:10]`
- 图表输出文件名: `{时间戳}_{饰品名}_{磨损度}_{周期}d_analysis.png`
