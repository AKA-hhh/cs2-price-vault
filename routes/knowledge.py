# -*- coding: utf-8 -*-
"""知识库 CRUD API"""

import time
import uuid
from flask import Blueprint, request, jsonify
import shared

knowledge_bp = Blueprint("knowledge", __name__)


def _kb_sort_key(e):
    ed = e.get("event_date")
    if ed:
        try:
            return time.mktime(time.strptime(ed, "%Y-%m-%d"))
        except Exception:
            pass
    return e.get("updated_at", e.get("created_at", 0))


@knowledge_bp.route("/api/knowledge", methods=["GET"])
def api_knowledge_list():
    q = (request.args.get("q") or "").strip().lower()
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", type=int, default=0)
    kb = shared._load_kb()
    if q:
        kb = [e for e in kb if q in e.get("title", "").lower()
              or q in e.get("content", "").lower()
              or any(q in t.lower() for t in e.get("tags", []))]
    kb.sort(key=_kb_sort_key, reverse=True)
    total = len(kb)
    if limit:
        kb = kb[offset:offset + limit]
    return jsonify({"items": kb, "total": total})


@knowledge_bp.route("/api/knowledge", methods=["POST"])
def api_knowledge_add():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify({"error": "标题和内容不能为空"}), 400
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    now = time.time()
    event_date = (data.get("event_date") or "").strip() or None
    entry = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "content": content,
        "tags": tags,
        "event_date": event_date,
        "created_at": now,
        "updated_at": now,
    }
    kb = shared._load_kb()
    kb.append(entry)
    shared._save_kb(kb)
    return jsonify(entry)


@knowledge_bp.route("/api/knowledge/<entry_id>", methods=["PUT"])
def api_knowledge_update(entry_id):
    data = request.get_json(force=True)
    kb = shared._load_kb()
    entry = next((e for e in kb if e.get("id") == entry_id), None)
    if not entry:
        return jsonify({"error": "条目不存在"}), 404
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify({"error": "标题和内容不能为空"}), 400
    entry["title"] = title
    entry["content"] = content
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    entry["tags"] = tags
    event_date = (data.get("event_date") or "").strip() or None
    if event_date is not None:
        entry["event_date"] = event_date
    elif "event_date" in data and not data["event_date"]:
        entry.pop("event_date", None)
    entry["updated_at"] = time.time()
    shared._save_kb(kb)
    return jsonify(entry)


@knowledge_bp.route("/api/knowledge/<entry_id>", methods=["DELETE"])
def api_knowledge_delete(entry_id):
    kb = shared._load_kb()
    kb = [e for e in kb if e.get("id") != entry_id]
    shared._save_kb(kb)
    return jsonify({"ok": True})
