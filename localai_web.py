# -*- coding: utf-8 -*-
"""
本地 AI 助手 · 现代界面版 本地服务
====================================================================
纯 Python 标准库实现，职责：

  1. 托管前端静态资源（index.html / style.css / app.js）
  2. 把 /proxy/* 转发到 Ollama（含流式 NDJSON）
  3. 提供 /api/* 接口：状态、设置、联网抓取、云端转发、后端重启
  4. 以 Edge/Chrome 的 --app 模式打开无边框应用窗口
  5. 窗口关闭时自动退出

启动：
    python localai_web.py
可选参数：
    --port 8799 --no-window --browser chrome|edge
"""

import argparse
import html
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 知识库模块（与本文件同目录；打包时 PyInstaller 会自动跟随 import 带上）
try:
    import localai_kb as KB
except Exception as _e:
    KB = None
    _KB_ERR = str(_e)
else:
    _KB_ERR = ""

APP = {"name": "本地 AI 助手", "sub": "LocalAI Studio", "ver": "3.0"}
DEPLOY_ROOT_HINTS = [r"E:\depseekbushu"]
CHUNK = 64 * 1024
INTERNET_TEST = [("www.baidu.com", 443), ("1.1.1.1", 443)]


# ================================================================ 路径


def exe_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def bundle_dir():
    return getattr(sys, "_MEIPASS", None)


def web_dir():
    """前端资源目录。优先用 exe 旁边的 web\，方便用户自己改界面。"""
    cands = []
    if bundle_dir():
        cands.append(os.path.join(bundle_dir(), "web"))
    cands.append(os.path.join(exe_dir(), "web"))
    cands.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "web"))
    for c in DEPLOY_ROOT_HINTS:
        cands.append(os.path.join(c, "web"))
    for c in cands:
        if os.path.isfile(os.path.join(c, "index.html")):
            return c
    return cands[0]


def find_deploy_root():
    cands = [os.environ.get("OLLAMA_DEPLOY_ROOT"), exe_dir(),
             os.path.dirname(exe_dir())] + DEPLOY_ROOT_HINTS
    for c in cands:
        if c and os.path.isfile(os.path.join(c, "ollama", "ollama.exe")):
            return c
    return None


def data_dir():
    for base in (exe_dir(), find_deploy_root()):
        if not base:
            continue
        d = os.path.join(base, "chats")
        try:
            os.makedirs(d, exist_ok=True)
            t = os.path.join(d, ".w")
            open(t, "w").close()
            os.remove(t)
            return d
        except Exception:
            continue
    d = os.path.join(os.path.expanduser("~"), ".localai_web")
    os.makedirs(d, exist_ok=True)
    return d


def profile_dir():
    """固定的浏览器 profile 目录。
    必须固定 —— localStorage 里的会话绑定在这个 origin + profile 上。
    也不能放在 chats\\ 里：那个目录会被清理/卸载删除，会让 Edge 的 profile 锁失效。"""
    d = os.path.join(os.path.dirname(data_dir()), "webprofile")
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except Exception:
        d = os.path.join(os.path.expanduser("~"), ".localai_webprofile")
        os.makedirs(d, exist_ok=True)
        return d


# ---------------------------------------------------------------- CA 证书
# MSYS2 的 Python 很坑：ssl 期望的 cert.pem 不存在，ca-bundle.crt 是 0 字节占位，
# 而且没有 enum_certificates（借不到 Windows 证书库），所以 HTTPS 一律失败。
# 真正可用的包在 etc\pki\ca-trust\extracted\pem\tls-ca-bundle.pem。
# 这里自动找一份非空的，设好环境变量；打包时会把 ca-bundle.pem 一起带上，
# 这样在没装 MSYS2 的机器上联网同样可用。

CA_BUNDLE = None


def setup_ssl():
    global CA_BUNDLE
    cands = []
    for base in ([bundle_dir()] if bundle_dir() else []):
        cands.append(os.path.join(base, "ca-bundle.pem"))
    cands.append(os.path.join(exe_dir(), "ca-bundle.pem"))
    cands.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ca-bundle.pem"))
    try:
        import certifi
        cands.insert(0, certifi.where())
    except Exception:
        pass
    try:
        import ssl as _ssl
        p = _ssl.get_default_verify_paths()
        cands += [p.openssl_cafile, p.cafile]
    except Exception:
        pass
    for base in (sys.prefix, os.path.dirname(os.path.dirname(sys.executable)),
                 r"D:\msys64\ucrt64", r"D:\msys64\mingw64"):
        cands += [
            os.path.join(base, "etc", "pki", "ca-trust", "extracted", "pem", "tls-ca-bundle.pem"),
            os.path.join(base, "etc", "ssl", "certs", "ca-bundle.crt"),
            os.path.join(base, "etc", "ssl", "cert.pem"),
            os.path.join(base, "ssl", "cert.pem"),
        ]
    for c in cands:
        try:
            if c and os.path.isfile(c) and os.path.getsize(c) > 4096:
                os.environ["SSL_CERT_FILE"] = c
                os.environ["REQUESTS_CA_BUNDLE"] = c
                CA_BUNDLE = c
                return c
        except Exception:
            continue
    return None


setup_ssl()

# ---------------------------------------------------------------- 安装引导
# 安装程序会把用户在安装时选择的路径写进 bootstrap.ini（放在程序目录下）。
# 用 key=value 而不是 JSON：Windows 路径里的反斜杠不用转义，NSIS 写起来也简单。

BOOTSTRAP_NAME = "bootstrap.ini"


def _read_text_any(path):
    """按可能的编码依次尝试，保证一定能读出内容。

    实测：NSIS 在 Unicode 模式下用 FileWrite 写的文本文件是
    **系统 ANSI 代码页（中文系统上是 GBK）**，而不是 UTF-16LE 也不是 UTF-8。
    PowerShell 写的又是 UTF-8。所以不能只试一种，顺序也要讲究：
    先看 BOM，再试严格 UTF-8，再 GBK，最后才轮到 UTF-16（它对任意字节
    都可能"猜"出一个结果，必须放在后面）。
    """
    with open(path, "rb") as f:
        raw = f.read()
    if not raw:
        return ""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return raw.decode("utf-16")
        except Exception:
            pass
    if raw[:3] == b"\xef\xbb\xbf":
        try:
            return raw.decode("utf-8-sig")
        except Exception:
            pass
    for enc in ("utf-8", "gbk", "utf-16", "latin-1"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", "replace")


def load_bootstrap():
    cands = []
    if bundle_dir():
        cands.append(os.path.join(bundle_dir(), BOOTSTRAP_NAME))
    cands.append(os.path.join(exe_dir(), BOOTSTRAP_NAME))
    cands.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), BOOTSTRAP_NAME))
    for p in cands:
        if not os.path.isfile(p):
            continue
        d = {}
        try:
            for line in _read_text_any(p).splitlines():
                line = line.strip().lstrip("\ufeff")
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip().strip('"')
        except Exception:
            continue
        if d:
            return d, p
    return {}, None


_BOOT, BOOT_PATH = load_bootstrap()


def read_registry_config():
    """读安装程序写进注册表的配置。

    为什么主要靠注册表：实测 NSIS 的 FileOpen/FileWrite 在这里会建出 0 字节的
    空文件（FileWrite 没写进去），而 WriteRegStr 一直很可靠。
    两条路都留着，读不到注册表就退回文件。
    """
    d = {}
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\LocalAIStudio") as k:
            for name in ("modelsDir", "host", "keepAlive", "installDir"):
                try:
                    v, _t = winreg.QueryValueEx(k, name)
                    if v:
                        d[name] = str(v)
                except Exception:
                    continue
    except Exception:
        pass
    return d


_REG = read_registry_config()

# 安装时选的配置：注册表优先，其次 bootstrap.ini
INSTALL_CFG = dict(_BOOT or {})
INSTALL_CFG.update(_REG)
CFG_SOURCE = ("注册表 HKCU\\Software\\LocalAIStudio" if _REG
              else (BOOT_PATH or ""))

if INSTALL_CFG.get("deployRoot"):
    os.environ.setdefault("OLLAMA_DEPLOY_ROOT", INSTALL_CFG["deployRoot"])

LOG_PATH = os.path.join(data_dir(), "localai.log")

# 生命周期：不要依赖浏览器进程（Edge/Chrome 会用单例模式交接给已有进程，
# 启动器进程会立刻退出，据此判断"用户关窗"必然误判）。
# 也不能把"页面卸载"直接当成"关窗"——页面重载同样会触发 pagehide。
# 所以：收到退出信号后给一个宽限期，期间只要有心跳就撤销。
_STATE = {"last_ping": 0.0, "got_ping": False, "quit_at": 0.0}
STOP = threading.Event()
QUIT_GRACE = 8.0           # 收到关窗信号后的宽限期（秒），页面重载会撤销
PING_TIMEOUT = 150.0       # 心跳超时（浏览器后台会限流定时器，必须给足余量）

# ⚠️ 这里曾经做过"窗口消失就自动重开"的自愈，那是个严重 bug：
#    它分不清"用户主动关窗"和"窗口被浏览器收走"，导致用户关掉窗口后
#    程序又自己弹回来（最多 30 次，一小时内）。
# 现在改为：
#    * 关窗 = 退出，绝不重开
#    * 首次运行的窗口不稳定问题，改用 prewarm_profile() 从根上避免


# ---------------------------------------------------------------- 日志

def log(msg):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass


def say(msg):
    print(msg)
    log(msg)


def fatal(msg):
    """无控制台运行时（--windowed），启动失败必须让用户看见"""
    log("FATAL " + msg.replace("\n", " | "))
    try:
        import tkinter as tk
        from tkinter import messagebox
        r = tk.Tk()
        r.withdraw()
        messagebox.showerror("%s 启动失败" % APP["name"],
                             "%s\n\n日志：\n%s" % (msg, LOG_PATH))
        r.destroy()
    except Exception:
        pass


# ================================================================ 配置


DEFAULT_SETTINGS = {
    "theme": "dark", "accent": "#5b8cff",
    "bgType": "grad", "bgGrad": 0, "bgSolid": "#0d1017",
    "bgUrl": "", "bgDim": 45, "bgBlur": 0, "bgFit": "cover",
    "fontSize": 15, "radius": 16, "chatWidth": 820, "anim": True, "blur": True,
    "params": {"temperature": 0.6, "top_p": 0.95, "num_ctx": 4096,
               "num_predict": 2048, "num_thread": 8},
    "host": "127.0.0.1:11434", "modelsDir": "", "keepAlive": "30m",
    "maxLoaded": "1",
    "netFetch": True, "cloudOn": False, "cloudBase": "", "cloudKey": "",
    "cloudModel": "", "lastModel": "",
    "embedModel": "qwen3-embedding:0.6b",
    "ragOn": False, "ragKb": "", "ragTopK": 5,
}


class Config:
    def __init__(self):
        self.path = os.path.join(data_dir(), "web-settings.json")
        self.lock = threading.Lock()
        self.data = dict(DEFAULT_SETTINGS)
        # 安装程序在安装时选的路径优先于内置默认值
        if INSTALL_CFG.get("modelsDir"):
            self.data["modelsDir"] = INSTALL_CFG["modelsDir"]
        if INSTALL_CFG.get("host"):
            self.data["host"] = INSTALL_CFG["host"]
        if INSTALL_CFG.get("keepAlive"):
            self.data["keepAlive"] = INSTALL_CFG["keepAlive"]
        if not self.data["modelsDir"]:
            root = find_deploy_root()
            if root:
                self.data["modelsDir"] = os.path.join(root, "models")
        # 用户在图形界面里改过的以界面为准（web-settings.json 后加载，会覆盖上面）
        self.load()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                self.data.update(json.load(f))
        except Exception:
            pass

    def save(self):
        with self.lock:
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump(self.data, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

    def get(self, k, d=None):
        return self.data.get(k, d)


CFG = Config()


# ================================================================ 系统信息


def mem_info():
    try:
        if os.name == "nt":
            import ctypes

            class MSX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = MSX()
            st.dwLength = ctypes.sizeof(MSX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
            return st.ullTotalPhys / 1e9, st.ullAvailPhys / 1e9
        return 0.0, 0.0
    except Exception:
        return 0.0, 0.0


def disk_free(path):
    try:
        import shutil
        return shutil.disk_usage(path).free / 1e9
    except Exception:
        return 0.0


def ollama_version(host, timeout=2.0):
    try:
        with urllib.request.urlopen("http://%s/api/version" % host, timeout=timeout) as r:
            return json.loads(r.read().decode()).get("version")
    except Exception:
        return None


_net_cache = {"t": 0, "online": False, "latency": 0}


def check_online(force=False):
    now = time.time()
    if not force and now - _net_cache["t"] < 20:
        return _net_cache["online"], _net_cache["latency"]
    online, lat = False, 0
    for host, port in INTERNET_TEST:
        t0 = time.time()
        try:
            s = socket.create_connection((host, port), timeout=2.0)
            s.close()
            online, lat = True, int((time.time() - t0) * 1000)
            break
        except Exception:
            continue
    _net_cache.update({"t": now, "online": online, "latency": lat})
    return online, lat


# ================================================================ 网页正文提取


class TextExtract(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "nav", "footer",
            "form", "iframe", "template"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
             "section", "article", "blockquote", "pre"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self._in_title = False
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data.strip()
        if self.skip:
            return
        t = data.strip()
        if t:
            self.parts.append(t + " ")

    def text(self):
        s = "".join(self.parts)
        s = re.sub(r"[ \t\u00a0]+", " ", s)
        s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
        return s.strip()


def fetch_page(url, limit=60000):
    if not re.match(r"^https?://", url, re.I):
        url = "http://" + url
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read(3_000_000)
        ctype = r.headers.get("Content-Type", "")
        final = r.geturl()
    enc = "utf-8"
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    if m:
        enc = m.group(1)
    else:
        m = re.search(br'charset=["\']?([\w-]+)', raw[:4000], re.I)
        if m:
            enc = m.group(1).decode("ascii", "ignore")
    try:
        page = raw.decode(enc, "replace")
    except Exception:
        page = raw.decode("utf-8", "replace")

    p = TextExtract()
    try:
        p.feed(page)
    except Exception:
        pass
    text = p.text()
    title = p.title.strip() or final
    if not text:
        text = re.sub(r"<[^>]+>", " ", page)
        text = html.unescape(re.sub(r"\s+", " ", text))
    if len(text) > limit:
        text = text[:limit] + "\n…（内容过长已截断）"
    return {"url": final, "title": title[:120], "text": text}


# ================================================================ Ollama 管理


def launch_backend():
    root = find_deploy_root()
    if not root:
        return False, "找不到 ollama.exe（部署根目录）"
    exe = os.path.join(root, "ollama", "ollama.exe")
    env = os.environ.copy()
    env["OLLAMA_HOST"] = CFG.get("host") or "127.0.0.1:11434"
    env["OLLAMA_MODELS"] = CFG.get("modelsDir") or os.path.join(root, "models")
    env["OLLAMA_KEEP_ALIVE"] = str(CFG.get("keepAlive") or "30m")
    env["OLLAMA_MAX_LOADED_MODELS"] = str(CFG.get("maxLoaded") or "1")
    env["OLLAMA_NUM_PARALLEL"] = "1"
    flags = 0x08000000 if os.name == "nt" else 0
    try:
        subprocess.Popen([exe, "serve"], env=env, creationflags=flags,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        return False, "启动失败：%s" % e
    for _ in range(45):
        time.sleep(1)
        if ollama_version(env["OLLAMA_HOST"], 1.5):
            return True, ""
    return False, "等待后端就绪超时"


def stop_backend():
    flags = 0x08000000 if os.name == "nt" else 0
    for n in ("ollama.exe", "llama-server.exe"):
        try:
            subprocess.run(["taskkill", "/F", "/IM", n],
                           capture_output=True, creationflags=flags)
        except Exception:
            pass


def ensure_backend():
    host = CFG.get("host") or "127.0.0.1:11434"
    if not ollama_version(host, 1.5):
        launch_backend()


# ---------------------------------------------------------------- 嵌入

def embed_texts(texts):
    """调用本地嵌入模型。优先 /api/embed，失败退回旧的 /api/embeddings。"""
    host = CFG.get("host") or "127.0.0.1:11434"
    model = CFG.get("embedModel") or "nomic-embed-text"
    texts = [t if t.strip() else " " for t in texts]
    body = json.dumps({"model": model, "input": texts}).encode("utf-8")
    req = urllib.request.Request("http://%s/api/embed" % host, data=body,
                                 method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            d = json.loads(r.read().decode("utf-8"))
        embs = d.get("embeddings")
        if embs and len(embs) == len(texts):
            return embs
    except Exception:
        pass
    # 退回旧接口（逐个嵌入）
    out = []
    for t in texts:
        b = json.dumps({"model": model, "prompt": t}).encode("utf-8")
        rq = urllib.request.Request("http://%s/api/embeddings" % host, data=b,
                                    method="POST",
                                    headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(rq, timeout=600) as r:
            out.append(json.loads(r.read().decode("utf-8"))["embedding"])
    return out


def kb_sync_model(kb_id):
    """嵌入模型换了就自动重建该库的索引（片段原文还在，不用重传文件）"""
    if KB is None or not kb_id:
        return 0
    try:
        return KB.ensure_model(data_dir(), kb_id, CFG.get("embedModel"), embed_texts)
    except Exception:
        return 0


# ================================================================ HTTP 服务


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalAIStudio/" + APP["ver"]

    # ---------- 基础输出 ----------
    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, code=200, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8") if isinstance(text, str) else text
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    # ---------- 分块流式 ----------
    def begin_stream(self, ctype="application/x-ndjson; charset=utf-8"):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()
        self._streaming = True

    def write_chunk(self, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        if not data:
            return
        try:
            self.wfile.write(b"%x\r\n" % len(data))
            self.wfile.write(data)
            self.wfile.write(b"\r\n")
            self.wfile.flush()
        except Exception:
            raise BrokenPipeError()

    def end_stream(self):
        try:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except Exception:
            pass

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        if n > 96 * 1024 * 1024:          # 防止超大请求把内存吃光
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p = u.path
        try:
            if p == "/" or p == "/index.html":
                return self.serve_static("index.html")
            if p.startswith("/static/"):
                return self.serve_static(p[len("/static/"):])
            if p == "/api/status":
                return self.api_status()
            if p == "/api/ping":
                _STATE["last_ping"] = time.time()
                _STATE["got_ping"] = True
                _STATE["quit_at"] = 0.0        # 页面还在，撤销退出意图
                return self.send_json({"ok": True})
            if p == "/api/quit":
                _STATE["quit_at"] = time.time()
                return self.send_json({"ok": True})
            if p == "/api/settings":
                return self.send_json(CFG.data)
            if p == "/api/about":
                return self.api_about()
            if p == "/api/kb/list":
                return self.api_kb_list()
            if p == "/favicon.ico":
                return self.send_text(b"", 200, "image/x-icon")
            if p.startswith("/proxy/"):
                return self.proxy(p[len("/proxy"):], "GET", None)
            self.send_json({"error": "not found: " + p}, 404)
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.send_json({"error": str(e)}, 500)
            except Exception:
                pass

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        p = u.path
        try:
            if p == "/api/settings":
                body = self.read_body()
                if isinstance(body, dict):
                    CFG.data.update(body)
                    CFG.save()
                return self.send_json({"ok": True})
            if p == "/api/ping":
                _STATE["last_ping"] = time.time()
                _STATE["got_ping"] = True
                _STATE["quit_at"] = 0.0        # 页面还在，撤销退出意图
                return self.send_json({"ok": True})
            if p == "/api/quit":
                _STATE["quit_at"] = time.time()
                return self.send_json({"ok": True})
            if p == "/api/net/fetch":
                return self.api_net_fetch()
            if p == "/api/kb/create":
                return self.api_kb_create()
            if p == "/api/kb/delete":
                return self.api_kb_delete()
            if p == "/api/kb/add":
                return self.api_kb_add()
            if p == "/api/kb/scan":
                return self.api_kb_scan()
            if p == "/api/kb/search":
                return self.api_kb_search()
            if p == "/api/cloud/chat":
                return self.api_cloud_chat()
            if p == "/api/backend/restart":
                threading.Thread(target=self._restart_bg, daemon=True).start()
                return self.send_json({"ok": True})
            if p == "/api/open-dir":
                d = CFG.get("modelsDir") or ""
                if d and os.path.isdir(d):
                    try:
                        os.startfile(d)
                    except Exception:
                        webbrowser.open("file:///" + d.replace("\\", "/"))
                    return self.send_json({"ok": True})
                return self.send_json({"error": "目录不存在"}, 400)
            if p.startswith("/proxy/"):
                return self.proxy(p[len("/proxy"):], "POST", self.read_body())
            self.send_json({"error": "not found: " + p}, 404)
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.send_json({"error": str(e)}, 500)
            except Exception:
                pass

    def do_DELETE(self):
        u = urllib.parse.urlparse(self.path)
        p = u.path
        try:
            if p.startswith("/proxy/"):
                return self.proxy(p[len("/proxy"):], "DELETE", self.read_body())
            self.send_json({"error": "not found"}, 404)
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.send_json({"error": str(e)}, 500)
            except Exception:
                pass

    def _restart_bg(self):
        stop_backend()
        time.sleep(2)
        launch_backend()

    # ---------- 静态 ----------
    MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
            ".ico": "image/x-icon", ".woff2": "font/woff2"}

    def serve_static(self, rel):
        rel = rel.split("?")[0].lstrip("/\\")
        base = os.path.realpath(web_dir())
        full = os.path.realpath(os.path.join(base, rel))
        if not full.startswith(base) or not os.path.isfile(full):
            return self.send_json({"error": "file not found: " + rel}, 404)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", self.MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    # ---------- /api ----------
    def api_status(self):
        host = CFG.get("host") or "127.0.0.1:11434"
        ver = ollama_version(host, 1.5)
        online, lat = check_online()
        total, avail = mem_info()
        d = CFG.get("modelsDir") or ""
        self.send_json({
            "ollama": {"ok": bool(ver), "version": ver or ""},
            "online": online, "latency": lat,
            "mem": {"total": round(total, 2), "avail": round(avail, 2)},
            "disk_free": round(disk_free(d if d and os.path.isdir(d) else exe_dir()), 2),
            "models_dir": d,
            "deploy_root": find_deploy_root() or "",
            "web_dir": web_dir(),
        })

    def api_about(self):
        total, avail = mem_info()
        return self.send_json({
            "程序": "%s %s v%s" % (APP["name"], APP["sub"], APP["ver"]),
            "界面技术": "HTML / CSS / JavaScript（原生，无框架）",
            "服务": "Python %s 标准库" % sys.version.split()[0],
            "前端目录": web_dir(),
            "数据目录": data_dir(),
            "部署根目录": find_deploy_root() or "(未找到)",
            "后端地址": CFG.get("host"),
            "模型目录": CFG.get("modelsDir"),
            "安装配置": CFG_SOURCE or "(无，用的是内置默认值)",
            "CA 证书": CA_BUNDLE or "(未找到，联网抓取可能失败)",
            "物理内存": "%.1f GB (可用 %.1f GB)" % (total, avail),
            "运行方式": "打包 exe" if getattr(sys, "frozen", False) else "python 源码",
        })

    # ---------- 知识库 ----------
    def _kb_guard(self):
        if KB is None:
            self.send_json({"error": "知识库模块不可用：%s" % _KB_ERR}, 500)
            return False
        return True

    def api_kb_list(self):
        if not self._kb_guard():
            return
        return self.send_json({"kbs": KB.list_kbs(data_dir()),
                               "embedModel": CFG.get("embedModel"),
                               "dataDir": data_dir()})

    def api_kb_create(self):
        if not self._kb_guard():
            return
        b = self.read_body() or {}
        name = (b.get("name") or "").strip() or "未命名知识库"
        kb_id = KB.create_kb(data_dir(), name, CFG.get("embedModel"))
        return self.send_json({"id": kb_id, "ok": True})

    def api_kb_delete(self):
        if not self._kb_guard():
            return
        b = self.read_body() or {}
        KB.delete_kb(data_dir(), b.get("id", ""))
        return self.send_json({"ok": True})

    def api_kb_add(self):
        """浏览器上传：files = [{name, text}]"""
        if not self._kb_guard():
            return
        b = self.read_body() or {}
        kb_id = b.get("id", "")
        files = [(f.get("name") or "?", f.get("text") or "")
                 for f in (b.get("files") or [])]
        if not files:
            return self.send_json({"error": "没有收到文件内容"}, 400)
        try:
            rebuilt = kb_sync_model(kb_id)
            n, msg = KB.add_files(data_dir(), kb_id, files, embed_texts)
            if rebuilt:
                msg = ("已按当前嵌入模型重建 %d 个片段；" % rebuilt) + (msg or "")
            return self.send_json({"ok": True, "chunks": n, "message": msg})
        except Exception as e:
            return self.send_json({"error": "建立索引失败：%s" % e}, 400)

    def api_kb_scan(self):
        """服务端扫描目录"""
        if not self._kb_guard():
            return
        b = self.read_body() or {}
        kb_id = b.get("id", "")
        path = (b.get("path") or "").strip().strip('"').strip("'")
        if not path:
            return self.send_json({"error": "请填写目录路径"}, 400)
        try:
            files, chunks, errors = KB.scan_dir(data_dir(), kb_id, path, embed_texts)
            return self.send_json({"ok": True, "files": files, "chunks": chunks,
                                   "errors": errors[:20]})
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)

    def api_kb_search(self):
        if not self._kb_guard():
            return
        b = self.read_body() or {}
        kb_id = b.get("id") or CFG.get("ragKb") or ""
        q = (b.get("query") or "").strip()
        if not kb_id or not q:
            return self.send_json({"hits": []})
        try:
            top_k = int(b.get("top_k") or CFG.get("ragTopK") or 5)
        except Exception:
            top_k = 5
        try:
            rebuilt = kb_sync_model(kb_id)
            hits = KB.search(data_dir(), kb_id, q, embed_texts, top_k=top_k)
            return self.send_json({"hits": hits, "context": KB.build_context(hits),
                                   "rebuilt": rebuilt})
        except Exception as e:
            return self.send_json({"error": "检索失败：%s" % e}, 400)

    def api_net_fetch(self):
        body = self.read_body()
        url = (body or {}).get("url", "").strip()
        if not url:
            return self.send_json({"error": "缺少 url"}, 400)
        try:
            r = fetch_page(url)
            if not r["text"]:
                return self.send_json({"error": "该页面没有可提取的正文"}, 400)
            return self.send_json(r)
        except urllib.error.HTTPError as e:
            return self.send_json({"error": "HTTP %s" % e.code}, 400)
        except Exception as e:
            return self.send_json({"error": "抓取失败：%s" % e}, 400)

    def api_cloud_chat(self):
        base = (CFG.get("cloudBase") or "").rstrip("/")
        key = CFG.get("cloudKey") or ""
        if not base or not key:
            return self.send_json({"error": "云端 API 未配置（设置 → 后端与联网）"}, 400)
        if not base.endswith("/v1"):
            base = base + "/v1" if not base.endswith("/chat/completions") else base
        url = base + "/chat/completions"
        body = self.read_body() or {}
        payload = {"model": body.get("model") or CFG.get("cloudModel") or "deepseek-chat",
                   "messages": body.get("messages", []), "stream": True,
                   "temperature": 0.7}
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + key,
                     "Accept": "text/event-stream"})
        try:
            resp = urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            return self.send_json({"error": "云端返回 HTTP %s：%s" % (e.code, detail)}, 400)
        except Exception as e:
            return self.send_json({"error": "无法连接云端：%s" % e}, 400)

        self.begin_stream("application/x-ndjson; charset=utf-8")
        try:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                self.write_chunk(data + "\n")
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.write_chunk(json.dumps({"error": str(e)}, ensure_ascii=False) + "\n")
            except Exception:
                pass
        finally:
            try:
                resp.close()
            except Exception:
                pass
            self.end_stream()

    # ---------- Ollama 反向代理 ----------
    def proxy(self, path, method, body):
        host = CFG.get("host") or "127.0.0.1:11434"
        url = "http://%s%s" % (host, path)
        if not path.startswith("/api/"):
            return self.send_json({"error": "bad proxy path"}, 400)

        # Ollama 的删除接口是 DELETE，前端统一用 POST 更省事
        if path.startswith("/api/delete"):
            method = "DELETE"

        data = None
        if body is not None and method != "GET":
            data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        streaming = path.startswith("/api/chat") or path.startswith("/api/pull") \
            or path.startswith("/api/generate") or path.startswith("/api/create")

        try:
            resp = urllib.request.urlopen(req, timeout=3600)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            return self.send_json({"error": "Ollama HTTP %s：%s" % (e.code, detail)}, 502)
        except Exception as e:
            return self.send_json({"error": "无法连接 Ollama：%s" % e}, 502)

        if not streaming:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "application/json")
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self._cors()
            self.end_headers()
            self.wfile.write(raw)
            resp.close()
            return

        self.begin_stream()
        buf = b""
        try:
            while True:
                chunk = resp.read(CHUNK)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if line:
                        self.write_chunk(line + b"\n")
        except BrokenPipeError:
            pass
        except Exception:
            pass
        finally:
            if buf.strip():
                try:
                    self.write_chunk(buf.strip() + b"\n")
                except Exception:
                    pass
            try:
                resp.close()
            except Exception:
                pass
            self.end_stream()


# ================================================================ 窗口


def find_browser(prefer=None):
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    la = os.environ.get("LOCALAPPDATA", "")
    cands = {
        "edge": [os.path.join(pf86, r"Microsoft\Edge\Application\msedge.exe"),
                 os.path.join(pf, r"Microsoft\Edge\Application\msedge.exe"),
                 os.path.join(la, r"Microsoft\Edge\Application\msedge.exe")],
        "chrome": [os.path.join(pf, r"Google\Chrome\Application\chrome.exe"),
                   os.path.join(pf86, r"Google\Chrome\Application\chrome.exe"),
                   os.path.join(la, r"Google\Chrome\Application\chrome.exe")],
    }
    # Chrome 优先。实测：Edge 的 --app 窗口在这台机器上约 40 秒后会自行消失
    # （新 profile 的后台模式/启动加速把它收走，加参数也无效），
    # 而 Chrome 连续观察 150 秒以上保持稳定。
    order = [prefer] if prefer in cands else []
    order += [k for k in ("chrome", "edge") if k not in order]
    for k in order:
        for p in cands.get(k, []):
            if os.path.isfile(p):
                return p, k
    return None, None


def prewarm_profile(exe):
    """
    首次运行时浏览器拿一个全新 profile 起 --app 窗口，可能几十秒后就被浏览器
    自己收走（Edge 实测约 40 秒，派生的 Chrome 也偶发）。与其"关了就重开"
    ——那会误伤正常关窗——不如先把 profile 初始化好再开正式窗口。

    做法：用无头模式跑一次，让它把 profile 结构（Default 目录等）建完即退出。
    返回 True 表示这次确实做了预热。
    """
    prof = profile_dir()
    if os.path.isdir(os.path.join(prof, "Default")):
        return False
    flags = 0x08000000 if os.name == "nt" else 0
    for extra in (["--headless=new", "--disable-gpu", "--dump-dom", "about:blank"],
                  ["--headless", "--disable-gpu", "--dump-dom", "about:blank"]):
        try:
            subprocess.run([exe, "--user-data-dir=" + prof,
                            "--no-first-run", "--no-default-browser-check"] + extra,
                           timeout=45, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=flags)
        except Exception:
            pass
        if os.path.isdir(os.path.join(prof, "Default")):
            return True
    return False


def running_instance(port):
    """该端口上是否已经有我们的服务在跑（用于重复启动时只叫出窗口）"""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/about" % port,
                                    timeout=2) as r:
            d = json.loads(r.read().decode("utf-8"))
        return str(d.get("程序", "")).startswith(APP["name"])
    except Exception:
        return False


def open_app_window(url, prefer=None, prewarm=True):
    exe, kind = find_browser(prefer)
    if not exe:
        webbrowser.open(url)
        return None
    if prewarm:
        try:
            if prewarm_profile(exe):
                print("  已预热浏览器配置目录（首次运行加速，避免窗口被收走）")
        except Exception:
            pass
    args = [exe,
            "--app=" + url,
            "--user-data-dir=" + profile_dir(),
            "--no-first-run", "--no-default-browser-check", "--no-service-autorun",
            "--disable-background-mode", "--disable-sync", "--disable-extensions",
            "--disable-component-update", "--disable-default-apps",
            "--disable-features=Translate,TranslateUI,BackgroundMode,StartupBoost,msEdgeTranslate",
            "--window-size=1280,860"]
    try:
        return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        webbrowser.open(url)
        return None


def pick_port(preferred):
    for p in [preferred] + [preferred + i for i in range(1, 12)]:
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            s.close()
            return p
        except OSError:
            s.close()
    return preferred


# ================================================================ 入口


def main():
    try:
        _main()
    except Exception as e:
        import traceback
        fatal("启动失败：%s\n\n%s" % (e, traceback.format_exc()[-900:]))


def _main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--no-window", action="store_true")
    ap.add_argument("--browser", default=None)
    ap.add_argument("--no-backend-start", action="store_true")
    args, _ = ap.parse_known_args()

    # 已经有实例在跑 → 只把窗口叫出来，不再起第二个服务
    if not args.no_window and running_instance(args.port):
        say("检测到已有实例在运行，直接打开窗口（不重复启动服务）。")
        open_app_window("http://127.0.0.1:%d" % args.port, args.browser)
        return

    port = pick_port(args.port)
    url = "http://127.0.0.1:%d" % port

    if not args.no_backend_start:
        threading.Thread(target=ensure_backend, daemon=True).start()

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    say("=" * 54)
    say("  %s · %s v%s" % (APP["name"], APP["sub"], APP["ver"]))
    say("=" * 54)
    say("  地址     : %s" % url)
    say("  前端目录 : %s" % web_dir())
    say("  数据目录 : %s" % data_dir())
    say("  部署根   : %s" % (find_deploy_root() or "(未找到)"))
    say("  CA 证书  : %s" % (CA_BUNDLE or "(未找到)"))
    say("=" * 54)

    def watchdog():
        # 收到过第一次心跳之后才开始判定，避免页面还没加载完就被判超时
        while not STOP.is_set():
            time.sleep(1.5)
            now = time.time()
            if not _STATE["got_ping"]:
                continue
            if _STATE["quit_at"] and now - _STATE["quit_at"] > QUIT_GRACE:
                say("界面已关闭，退出。")
                STOP.set()
            elif now - _STATE["last_ping"] > PING_TIMEOUT:
                say("心跳超时 %d 秒，退出。" % int(PING_TIMEOUT))
                STOP.set()

    threading.Thread(target=watchdog, daemon=True).start()

    if args.no_window:
        say("  （--no-window：请手动在浏览器打开上面的地址）")
    else:
        proc = open_app_window(url, args.browser)
        if proc is None:
            say("  未找到 Chrome/Edge，已用默认浏览器打开。")
        else:
            say("  已打开应用窗口，关闭该窗口即可退出。")

    try:
        while not STOP.is_set():
            STOP.wait(1.0)
    except KeyboardInterrupt:
        pass
    say("  正在退出…")
    try:
        httpd.shutdown()
    except Exception:
        pass


if __name__ == "__main__":
    main()
