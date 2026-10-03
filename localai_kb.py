# -*- coding: utf-8 -*-
"""
本地知识库（RAG）核心模块
====================================================================
纯标准库实现。职责：

  1. 把文档切成带重叠的片段
  2. 调用本地嵌入模型把片段变成向量（归一化后余弦相似度 = 点积）
  3. 持久化到磁盘，提问时做语义检索
  4. 支持按目录批量导入

存储结构（每个知识库一个目录）：

    <data_dir>/kb/<kb_id>/
        data.json      {meta:{...}, chunks:[{t:文本, s:来源}]}
        vectors.bin    归一化后的 float32，N × 768，小端

设计取舍：
  * 不做增量更新 —— 每次改动整体重写。几千个片段（几 MB）完全够快，
    换来的是实现简单、不会有索引与数据不一致的问题。
  * 向量检索用纯 Python 点积。5000 × 768 ≈ 380 万次乘加，
    实测在几百毫秒量级，对本地单用户足够。
"""

import hashlib
import html
import json
import math
import os
import re
import struct
import threading
import time
import uuid

# 可导入的文本类扩展名
TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv",
    ".py", ".pyw", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx",
    ".java", ".kt", ".js", ".mjs", ".ts", ".jsx", ".tsx", ".vue",
    ".json", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".toml",
    ".html", ".htm", ".xml", ".css", ".scss", ".sql",
    ".sh", ".bash", ".bat", ".cmd", ".ps1", ".tex", ".pas", ".go", ".rs",
}

# 扫描目录时跳过的目录
SKIP_DIRS = {
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".idea", ".vscode",
    "venv", ".venv", "env", "dist", "build", ".cache", "$RECYCLE.BIN",
    "System Volume Information", "Windows", "Program Files", "Program Files (x86)",
}

MAX_FILE_MB = 20          # 单文件上限
MAX_CHARS_PER_FILE = 2_000_000
CHUNK_SIZE = 600          # 片段目标长度（字符）
CHUNK_OVERLAP = 90        # 片段间重叠
EMBED_BATCH = 16          # 每次请求嵌入多少条

_lock = threading.Lock()
_cache = {}               # kb_id -> {"chunks":[...], "vecs":array('f'), "mtime":float}


# ================================================================ 工具


def _kb_root(data_dir):
    d = os.path.join(data_dir, "kb")
    os.makedirs(d, exist_ok=True)
    return d


def _kb_dir(data_dir, kb_id):
    return os.path.join(_kb_root(data_dir), kb_id)


def _read_text(path):
    """尽力读取文本文件，兼容 UTF-8 / GBK / Latin-1"""
    with open(path, "rb") as f:
        raw = f.read(MAX_FILE_MB * 1024 * 1024 + 1)
    if len(raw) > MAX_FILE_MB * 1024 * 1024:
        raise ValueError("文件超过 %d MB" % MAX_FILE_MB)
    for enc in ("utf-8", "utf-8-sig", "gbk", "big5", "latin-1"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", "replace")


def _strip_html(s):
    s = re.sub(r"(?is)<(script|style|noscript|svg|head)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t\u00a0]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


def _clean(s):
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t\u00a0]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def chunk_text(text, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """按段落聚合切块，超长段落硬切并保留重叠"""
    text = _clean(text)
    if not text:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf = [], ""

    def flush():
        nonlocal buf
        if buf.strip():
            chunks.append(buf.strip())
        buf = ""

    for p in paras:
        if len(p) > size:
            flush()
            step = max(1, size - overlap)
            for i in range(0, len(p), step):
                seg = p[i:i + size]
                if seg.strip():
                    chunks.append(seg.strip())
                if i + size >= len(p):
                    break
            continue
        if len(buf) + len(p) + 1 <= size:
            buf = (buf + "\n\n" + p) if buf else p
        else:
            flush()
            # 用上一块的尾部做重叠，保证跨块语义连续
            if chunks and overlap > 0:
                buf = chunks[-1][-overlap:] + "\n\n" + p
            else:
                buf = p
            if len(buf) > size * 1.6:
                flush()
                buf = p
    flush()

    # 去重 + 丢掉过短的碎片
    out, seen = [], set()
    for c in chunks:
        if len(c) < 20:
            continue
        h = hashlib.md5(c.encode("utf-8", "ignore")).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        out.append(c)
    return out


def _norm(vec):
    s = 0.0
    for x in vec:
        s += x * x
    if s <= 0:
        return vec
    inv = 1.0 / math.sqrt(s)
    return [x * inv for x in vec]


# ================================================================ 元数据


def list_kbs(data_dir):
    root = _kb_root(data_dir)
    out = []
    for name in sorted(os.listdir(root)):
        meta_path = os.path.join(root, name, "data.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                d = json.load(f)
            m = d.get("meta", {})
            out.append({
                "id": name,
                "name": m.get("name", name),
                "created": m.get("created", 0),
                "chunks": len(d.get("chunks", [])),
                "dims": m.get("dims", 0),
                "model": m.get("model", ""),
                "sources": sorted({c.get("s", "?") for c in d.get("chunks", [])}),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x.get("created", 0), reverse=True)
    return out


def get_meta(data_dir, kb_id):
    p = os.path.join(_kb_dir(data_dir, kb_id), "data.json")
    if not os.path.isfile(p):
        return None
    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
    return d.get("meta", {})


def create_kb(data_dir, name, model, dims=0):
    kb_id = uuid.uuid4().hex[:12]
    d = _kb_dir(data_dir, kb_id)
    os.makedirs(d, exist_ok=True)
    meta = {"name": name or "未命名知识库", "created": time.time(),
            "model": model, "dims": dims}
    _write(data_dir, kb_id, meta, [], None)
    return kb_id


def delete_kb(data_dir, kb_id):
    import shutil
    d = _kb_dir(data_dir, kb_id)
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
    with _lock:
        _cache.pop(kb_id, None)


# ================================================================ 读写


def _write(data_dir, kb_id, meta, chunks, vecs):
    d = _kb_dir(data_dir, kb_id)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "data.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "chunks": chunks}, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(d, "data.json"))
    if vecs is not None:
        tmpb = os.path.join(d, "vectors.bin.tmp")
        with open(tmpb, "wb") as f:
            f.write(struct.pack("<%df" % len(vecs), *vecs))
        os.replace(tmpb, os.path.join(d, "vectors.bin"))
    with _lock:
        _cache.pop(kb_id, None)


def _load(data_dir, kb_id):
    d = _kb_dir(data_dir, kb_id)
    dp = os.path.join(d, "data.json")
    if not os.path.isfile(dp):
        return None, [], None
    with _lock:
        c = _cache.get(kb_id)
    mt = os.path.getmtime(dp)
    if c and c["mtime"] == mt:
        return c["meta"], c["chunks"], c["vecs"]

    with open(dp, "r", encoding="utf-8") as f:
        obj = json.load(f)
    meta, chunks = obj.get("meta", {}), obj.get("chunks", [])
    vecs = []
    vp = os.path.join(d, "vectors.bin")
    if os.path.isfile(vp):
        with open(vp, "rb") as f:
            raw = f.read()
        n = len(raw) // 4
        vecs = list(struct.unpack("<%df" % n, raw[:n * 4]))
    with _lock:
        _cache[kb_id] = {"meta": meta, "chunks": chunks, "vecs": vecs, "mtime": mt}
    return meta, chunks, vecs


# ================================================================ 写入内容


def _embed_all(embed_fn, texts):
    """分批嵌入，返回 [向量]"""
    out = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i:i + EMBED_BATCH]
        vecs = embed_fn(batch)
        if not vecs or len(vecs) != len(batch):
            raise RuntimeError("嵌入返回数量不匹配（期望 %d，实际 %s）"
                               % (len(batch), len(vecs) if vecs else 0))
        out.extend(vecs)
    return out


def ensure_model(data_dir, kb_id, model, embed_fn):
    """
    嵌入模型换了就自动重建索引。
    片段原文一直保留在 chunks 里，所以可以直接重新嵌入，不用用户重传文件。
    返回重建的片段数（0 表示无需重建）。
    """
    if not model:
        return 0
    meta, chunks, _ = _load(data_dir, kb_id)
    if meta is None:
        return 0
    if meta.get("model") == model:
        return 0
    if not chunks:
        meta["model"] = model
        _write(data_dir, kb_id, meta, [], None)
        return 0
    new = _embed_all(embed_fn, [c["t"] for c in chunks])
    dims = len(new[0])
    flat = []
    for v in new:
        flat.extend(_norm(v))
    meta["model"] = model
    meta["dims"] = dims
    _write(data_dir, kb_id, meta, chunks, flat)
    return len(chunks)


def add_texts(data_dir, kb_id, sources, embed_fn):
    """
    sources: [(来源名, 纯文本)] —— 同名来源会被整体替换
    返回 (新增片段数, 跳过说明)
    """
    meta, chunks, vecs = _load(data_dir, kb_id)
    if meta is None:
        raise RuntimeError("知识库不存在")

    names = {s for s, _ in sources}
    keep = [c for c in chunks if c.get("s") not in names]
    keep_idx = [i for i, c in enumerate(chunks) if c.get("s") not in names]

    dims = meta.get("dims") or 0
    old_vecs = vecs or []
    if dims and old_vecs:
        kept_vecs = []
        for i in keep_idx:
            kept_vecs.extend(old_vecs[i * dims:(i + 1) * dims])
    else:
        kept_vecs = []

    new_chunks = []
    for src, text in sources:
        for piece in chunk_text(text):
            new_chunks.append({"t": piece, "s": src})

    if not new_chunks:
        _write(data_dir, kb_id, meta, keep, kept_vecs if kept_vecs else None)
        return 0, "没有可索引的文本内容"

    new_vecs = _embed_all(embed_fn, [c["t"] for c in new_chunks])
    dims = len(new_vecs[0])
    flat = []
    for v in new_vecs:
        flat.extend(_norm(v))

    meta["dims"] = dims
    _write(data_dir, kb_id, meta, keep + new_chunks, kept_vecs + flat)
    return len(new_chunks), ""


def add_files(data_dir, kb_id, files, embed_fn):
    """
    files: [(文件名, 文本内容)]
    """
    sources = []
    skipped = []
    for name, text in files:
        if not text or not text.strip():
            skipped.append(name)
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in (".html", ".htm", ".xml"):
            text = _strip_html(text)
        if len(text) > MAX_CHARS_PER_FILE:
            text = text[:MAX_CHARS_PER_FILE]
        sources.append((name, text))
    n, msg = add_texts(data_dir, kb_id, sources, embed_fn)
    if skipped:
        msg = (msg + "；" if msg else "") + "跳过空文件 %d 个" % len(skipped)
    return n, msg


def scan_dir(data_dir, kb_id, path, embed_fn, log=None):
    """递归扫描目录，导入所有文本类文件"""
    if not os.path.isdir(path):
        raise RuntimeError("目录不存在：%s" % path)
    total_files, total_chunks, errors = 0, 0, []
    batch = []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in TEXT_EXTS:
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, path)
            try:
                text = _read_text(full)
            except Exception as e:
                errors.append("%s: %s" % (rel, e))
                continue
            if ext in (".html", ".htm", ".xml"):
                text = _strip_html(text)
            if not text.strip():
                continue
            batch.append((rel, text))
            total_files += 1
            if len(batch) >= 8:
                n, _ = add_files(data_dir, kb_id, batch, embed_fn)
                total_chunks += n
                batch = []
                if log:
                    log("已导入 %d 个文件 / %d 个片段" % (total_files, total_chunks))
    if batch:
        n, _ = add_files(data_dir, kb_id, batch, embed_fn)
        total_chunks += n
    return total_files, total_chunks, errors


# ================================================================ 检索


def search(data_dir, kb_id, query, embed_fn, top_k=5, min_score=0.30):
    meta, chunks, vecs = _load(data_dir, kb_id)
    if not chunks or not vecs:
        return []
    dims = meta.get("dims") or 0
    if not dims:
        return []
    qv = embed_fn([query])
    if not qv:
        return []
    q = _norm(qv[0])

    n = len(chunks)
    scores = []
    for i in range(n):
        base = i * dims
        if base + dims > len(vecs):
            break
        s = 0.0
        for j in range(dims):
            s += q[j] * vecs[base + j]
        if s >= min_score:
            scores.append((s, i))
    scores.sort(reverse=True)

    out = []
    for s, i in scores[:top_k]:
        out.append({"score": round(s, 4),
                    "source": chunks[i].get("s", "?"),
                    "text": chunks[i].get("t", "")})
    return out


def build_context(hits, max_chars=4000):
    """把检索结果拼成给模型的上下文块"""
    if not hits:
        return ""
    parts, used = [], 0
    for h in hits:
        block = "【来源：%s】\n%s" % (h["source"], h["text"])
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    if not parts:
        return ""
    return ("\n\n[以下是本地知识库中检索到的资料，请优先依据这些内容回答；"
            "如果资料里没有，请明确说不知道，不要编造]\n\n"
            + "\n\n---\n\n".join(parts) + "\n")
