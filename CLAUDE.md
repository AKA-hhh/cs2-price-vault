# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CS2 饰品价格分析桌面应用 — a Flask-based desktop application for CS2 skin price analysis. It fetches price history from the csqaq.com API, computes technical indicators, runs a rule-engine recommendation, and optionally calls the DeepSeek AI for multi-dimensional analysis. The frontend is a single-page vanilla JS app with SSE streaming for AI chat.

## How to run

```bash
pip install -r requirements.txt
python app.py
# Opens http://127.0.0.1:5000 automatically
```

No tests, no linting, no build step. This is a single-developer desktop tool.

## Architecture

```
app.py                     # Flask server — all routes live here (monolith)
core/
  config.py                # .env loader, constants, period presets
  api_client.py            # csqaq.com API wrapper (K-line, chart, item detail, market overview)
  indicators.py            # Technical indicators → pandas DataFrame columns
  recommendation.py        # Rule engine: scores -100..100, outputs buy/hold/sell
  ai_analysis.py           # DeepSeek API calls — initial analysis + multi-turn chat
  visualization.py         # matplotlib chart (K-line/price + volume + RSI + MACD + KDJ subplots)
  id_map.py                # Fuzzy item search (substring + difflib fallback)
  utils.py                 # Filename sanitization, wear level extraction
templates/index.html       # Single-page app
static/js/app.js           # Vanilla JS frontend (search, analyze, SSE chat, watchlist/portfolio)
static/css/style.css       # Design system ("The Vault · 藏馆") — CSS custom properties
data/饰品id_20260423.json  # Item ID→name mapping (loaded at startup)
history/                   # Persisted analysis sessions (JSON metadata + PNG charts)
portfolio.json             # User holdings (id, buy_price, quantity, current_price)
watchlist.json             # User watchlist (id, prices, changes)
analysis_output/           # Saved chart PNGs per analysis
settings.json              # UI preferences (theme, accent, font_size)
.env                       # Secrets: API_TOKEN, DEEPSEEK_API_KEY, model names, temperatures
```

## Key data flow

1. User searches item name → `POST /api/search` → `id_map.search_item()` fuzzy match
2. User clicks "Analyze" → `POST /api/analyze`:
   - `api_client.get_item_price_history()` → pandas DataFrame (K-line preferred, falls back to chart endpoint)
   - `indicators.compute_indicators()` → adds MA/RSI/MACD/Bollinger/KDJ columns
   - `recommendation.generate_recommendation()` → rule-engine score + action
   - `ai_analysis.get_ai_analysis()` → DeepSeek multi-dimensional report
   - `visualization.plot_analysis()` → matplotlib chart → base64 PNG
   - Result persisted to `history/{id}.json` + `history/{id}.png`
3. Follow-up chat: `POST /api/chat` (non-streaming) or `POST /api/chat/stream` (SSE) — appends to conversation history in the analysis session

## External API dependencies

- **csqaq.com** (requires `API_TOKEN` in `.env`): K-line endpoint `/api/v1/info/simple/chartAll`, chart endpoint `/api/v1/info/chart`, item detail `/api/v1/info/good`, market overview `/api/v1/current_data?type=init`. Rate-limited — `api_client.py` enforces 1s delay between requests with exponential backoff on 429.
- **DeepSeek** (requires `DEEPSEEK_API_KEY` in `.env`): Chat completions endpoint. Two model slots — `DEEPSEEK_MODEL` for initial analysis (default `deepseek-v4-pro`), `DEEPSEEK_CHAT_MODEL` for follow-up chat (default `deepseek-v4-flash`). Configured via `.env` or the in-app settings page.

## State management

- Session data stored in-memory (`user_sessions` dict keyed by `_local_`) and persisted to `history/` as JSON+PNG files. Restored on startup via `_load_analyses_from_disk()`.
- Watchlist and portfolio are flat JSON files read/written on every API call.
- Settings split: API keys/temperatures → `.env`; UI preferences → `settings.json`.

## Conventions

- Chinese comments and UI text throughout (target audience is Chinese-speaking CS2 traders)
- matplotlib uses SimHei/Microsoft YaHei for CJK font rendering; Agg backend (non-interactive)
- All API responses are JSON; chart images are base64-encoded PNGs
- Analysis IDs are 10-char hex UUIDs; max 50 analyses retained per user (oldest evicted)
