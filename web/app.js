/* =====================================================================
   本地 AI 助手 · 前端逻辑
   纯原生 JavaScript，无任何第三方依赖 / 无 CDN（必须能离线运行）
   ===================================================================== */
"use strict";

/* ==================== 常量 ==================== */

const APP = { name:"本地 AI 助手", sub:"LocalAI Studio", ver:"3.0" };

const CATALOG = [
  ["deepseek-r1:1.5b","1.8B",1.04,"推理","最轻量的 DeepSeek 推理模型，速度快但常识较弱"],
  ["deepseek-r1:7b","7.6B",4.36,"推理","DeepSeek-R1 蒸馏版，质量与速度平衡最佳"],
  ["deepseek-r1:8b","8B",4.87,"推理","Llama 3.1 蒸馏版，体积略大"],
  ["deepseek-r1:14b","14.8B",8.37,"推理","需要 12GB 以上空闲内存"],
  ["deepseek-r1:32b","32.8B",18.49,"推理","需要 24GB 以上内存，本机基本不可用"],
  ["qwen3:0.6b","0.6B",0.49,"通用","极小体积，适合低配机器或快速实验"],
  ["qwen3:1.7b","1.7B",1.27,"通用","轻量通用模型，支持思考模式"],
  ["qwen3:4b","4B",2.33,"通用","小体积高质量，16GB 内存的甜点选择"],
  ["qwen3:8b","8B",4.87,"通用","综合能力强，与 7B 同量级"],
  ["qwen3:14b","14B",8.64,"通用","需要 12GB 以上空闲内存"],
  ["qwen2.5:0.5b","0.5B",0.37,"通用","几乎不占内存，可作脚本/分类用途"],
  ["qwen2.5:1.5b","1.5B",0.92,"通用","轻量通用，中文表现好"],
  ["qwen2.5:3b","3B",1.80,"通用","小体积，中文与代码兼顾"],
  ["qwen2.5:7b","7.6B",4.36,"通用","成熟稳定的中文通用模型"],
  ["llama3.2:1b","1.2B",1.23,"通用","Meta 轻量模型，英文较强"],
  ["llama3.2:3b","3.2B",1.88,"通用","小而快的通用助手"],
  ["gemma3:1b","1B",0.76,"通用","Google 轻量模型，多语言"],
  ["gemma3:4b","4B",3.11,"通用","质量好，多语言能力强"],
  ["gemma3:12b","12B",7.59,"通用","需要 10GB 以上空闲内存"],
  ["mistral:7b","7.2B",4.07,"通用","经典开源模型，英文写作流畅"],
  ["phi4:14b","14.7B",8.43,"通用","微软小模型，推理与数学强"],
  ["llava:7b","7B",3.83,"视觉","可以看图并回答问题"],
  ["nomic-embed-text:latest","-",0.26,"嵌入","英文向嵌入模型，中文检索效果差，已不推荐"],
  ["qwen3-embedding:0.6b","0.6B",0.60,"嵌入","★ 多语言嵌入模型，中文检索首选（本地知识库用这个）"],
  ["deepseek-coder-v2:16b","15.7B",8.29,"代码","代码补全与生成，需要 12GB 内存"],
  ["codegemma:7b","7B",4.67,"代码","Google 代码模型"],
];
const CATS = ["全部","推理","通用","代码","视觉","嵌入"];

const ACCENTS = [
  ["#5b8cff","经典蓝"],["#8b5cf6","紫罗兰"],["#10b981","翡翠绿"],
  ["#f59e0b","琥珀"],["#ef4444","珊瑚红"],["#06b6d4","青蓝"],
  ["#ec4899","品红"],["#64748b","石墨灰"],
];
const GRADIENTS = [
  ["linear-gradient(135deg,#1e3a8a,#4c1d95)","深海"],
  ["linear-gradient(135deg,#0f172a,#334155)","石墨"],
  ["linear-gradient(135deg,#064e3b,#0f766e)","森林"],
  ["linear-gradient(135deg,#7c2d12,#9d174d)","暮色"],
  ["linear-gradient(135deg,#1e1b4b,#312e81)","午夜"],
  ["linear-gradient(135deg,#831843,#4c1d95)","霓虹"],
  ["linear-gradient(135deg,#134e4a,#155e75)","极光"],
  ["linear-gradient(135deg,#292524,#44403c)","火山岩"],
];
const DEFAULT_PARAMS = { temperature:0.6, top_p:0.95, num_ctx:4096, num_predict:2048, num_thread:8 };
const PARAM_SPEC = [
  ["temperature","随机性",0,1.5,0.05,false],
  ["top_p","采样范围",0.1,1,0.05,false],
  ["num_ctx","上下文长度",512,32768,512,true],
  ["num_predict","最多生成",128,8192,128,true],
  ["num_thread","CPU 线程",1,32,1,true],
];

const WELCOME_CARDS = [
  ["解释一个概念","用一句话解释什么是递归"],
  ["写一段代码","用 Python 写一个二分查找"],
  ["翻译","把这句话翻译成英文：今天天气很好"],
  ["逻辑推理","3 个人 3 天喝 3 桶水，9 个人 9 天喝几桶水？"],
];

/* ==================== 小工具 ==================== */

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const fmtGB = g => g >= 1 ? g.toFixed(2) + " GB" : Math.round(g * 1024) + " MB";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function toast(msg, kind) {
  const t = el("div", "toast" + (kind ? " " + kind : ""), esc(msg));
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 280); }, kind === "err" ? 4200 : 2400);
}

function ask(title, msg, defVal) {
  return new Promise(res => {
    const mask = el("div", "dlg-mask");
    mask.innerHTML = `<div class="dlg"><h3>${esc(title)}</h3>${msg ? `<p>${esc(msg)}</p>` : ""}
      ${defVal !== undefined ? '<input id="_dlg_i">' : ""}
      <div class="acts"><button class="btn" data-no>取消</button><button class="btn primary" data-ok>确定</button></div></div>`;
    document.body.appendChild(mask);
    const inp = $("#_dlg_i", mask);
    if (inp) { inp.value = defVal || ""; setTimeout(() => { inp.focus(); inp.select(); }, 40); }
    const done = v => { mask.remove(); res(v); };
    $("[data-ok]", mask).onclick = () => done(inp ? inp.value : true);
    $("[data-no]", mask).onclick = () => done(null);
    mask.onclick = e => { if (e.target === mask) done(null); };
    if (inp) inp.onkeydown = e => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); };
  });
}

/* ==================== Markdown 渲染 ==================== */

function mdRender(src) {
  let t = esc(src);
  const codes = [];
  // 围栏代码块
  t = t.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = codes.length;
    codes.push({ lang: lang || "", code: code.replace(/\n$/, "") });
    return `\u0000C${id}\u0000`;
  });
  // 行内代码
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // 标题
  t = t.replace(/^###### (.*)$/gm, "<h3>$1</h3>")
       .replace(/^##### (.*)$/gm, "<h3>$1</h3>")
       .replace(/^#### (.*)$/gm, "<h3>$1</h3>")
       .replace(/^### (.*)$/gm, "<h3>$1</h3>")
       .replace(/^## (.*)$/gm, "<h2>$1</h2>")
       .replace(/^# (.*)$/gm, "<h1>$1</h1>");
  // 分隔线
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, "<hr>");
  // 引用
  t = t.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");
  // 粗体 / 斜体 / 删除线
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
       .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
       .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  // 链接
  t = t.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  // 列表
  t = t.replace(/^(?:[-*+] )(.*)$/gm, "<li>$1</li>");
  t = t.replace(/^(\d+)\. (.*)$/gm, "<li>$2</li>");
  t = t.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");
  // 表格
  t = t.replace(/^\|(.+)\|\s*\n\|[\s:|-]+\|\s*\n((?:\|.*\|\s*\n?)*)/gm, (m, head, body) => {
    const th = head.split("|").map(s => s.trim()).filter(s => s !== "");
    const rows = body.trim().split("\n").filter(Boolean).map(r =>
      r.replace(/^\||\|$/g, "").split("|").map(s => s.trim()));
    return "<table><thead><tr>" + th.map(h => `<th>${h}</th>`).join("") + "</tr></thead><tbody>" +
      rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
  });
  // 段落
  t = t.split(/\n{2,}/).map(p => {
    p = p.trim();
    if (!p) return "";
    if (/^<(h\d|ul|ol|pre|blockquote|table|hr|div)/.test(p)) return p;
    return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
  }).join("");

  // 还原代码块
  t = t.replace(/\u0000C(\d+)\u0000/g, (_, i) => {
    const c = codes[+i];
    return `<div class="code-wrap">${c.lang ? `<span class="code-lang">${esc(c.lang)}</span>` : ""}
      <div class="code-bar"><button data-copy>复制</button></div>
      <pre><code>${c.code}</code></pre></div>`;
  });
  return t;
}

/* ==================== 状态 ==================== */

const S = {
  settings: null,
  convs: [],
  curId: null,
  models: [],
  streaming: false,
  ctrl: null,
  attachments: [],
  cloudMode: false,
  online: false,
  marketState: {},
  modelsInfo: {},
};

const store = {
  load() {
    try { S.convs = JSON.parse(localStorage.getItem("lai.convs") || "[]"); } catch (e) { S.convs = []; }
    try { S.curId = localStorage.getItem("lai.cur") || null; } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem("lai.convs", JSON.stringify(S.convs));
      localStorage.setItem("lai.cur", S.curId || "");
    } catch (e) {}
  },
};

const cur = () => S.convs.find(c => c.id === S.curId) || null;

function newConv(model) {
  const c = { id: uid(), title: "新对话", model: model || "", messages: [], sys: "",
              params: Object.assign({}, S.settings.params), created: Date.now() };
  S.convs.unshift(c);
  S.curId = c.id;
  store.save();
  return c;
}

/* ==================== API ==================== */

const api = {
  async get(p) { const r = await fetch(p); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); },
  async post(p, body) {
    const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  },
  async del(p, body) {
    const r = await fetch(p, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  },
  async *stream(p, body) {
    const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 300));
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { yield JSON.parse(line); } catch (e) {}
      }
    }
    if (buf.trim()) { try { yield JSON.parse(buf.trim()); } catch (e) {} }
  },
};

/* ==================== 设置 ==================== */

const DEFAULT_SETTINGS = {
  theme: "dark", accent: "#5b8cff",
  bgType: "grad", bgGrad: 0, bgSolid: "#0d1017", bgUrl: "", bgDim: 45, bgBlur: 0, bgFit: "cover",
  fontSize: 15, radius: 16, chatWidth: 820, anim: true, blur: true,
  params: Object.assign({}, DEFAULT_PARAMS),
  host: "127.0.0.1:11434", modelsDir: "", keepAlive: "30m", maxLoaded: "1",
  netFetch: true, cloudOn: false, cloudBase: "", cloudKey: "", cloudModel: "",
};

function applySettings() {
  const s = S.settings;
  const root = document.documentElement;

  let theme = s.theme;
  if (theme === "auto") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.dataset.theme = theme;
  root.dataset.anim = s.anim ? "1" : "0";
  root.dataset.blur = s.blur ? "1" : "0";

  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--font-size", s.fontSize + "px");
  root.style.setProperty("--radius", s.radius + "px");
  root.style.setProperty("--chat-width", s.chatWidth + "px");

  // 背景
  const bg = $("#bg-layer"), veil = $("#bg-veil");
  bg.style.backgroundImage = "none";
  bg.style.backgroundColor = "transparent";
  bg.style.filter = "none";
  bg.style.backgroundRepeat = "no-repeat";
  bg.style.backgroundSize = "cover";

  const dim = s.bgDim / 100;
  if (s.bgType === "grad") {
    const g = GRADIENTS[s.bgGrad] || GRADIENTS[0];
    bg.style.backgroundImage = g[0];
    veil.style.background = "transparent";
  } else if (s.bgType === "solid") {
    bg.style.backgroundColor = s.bgSolid;
    veil.style.background = "transparent";
  } else if (s.bgType === "image" && s.bgUrl) {
    bg.style.backgroundImage = `url("${s.bgUrl.replace(/"/g, '\\"')}")`;
    bg.style.backgroundSize = s.bgFit === "repeat" ? "auto" : (s.bgFit || "cover");
    bg.style.backgroundRepeat = s.bgFit === "repeat" ? "repeat" : "no-repeat";
    bg.style.filter = s.bgBlur ? `blur(${s.bgBlur}px)` : "none";
    veil.style.background = `rgba(0,0,0,${dim})`;
    // 图片背景时让面板更实一点，保证可读性
    root.style.setProperty("--surface-solid", theme === "dark" ? "rgba(20,24,34,.92)" : "rgba(255,255,255,.94)");
  } else {
    veil.style.background = "var(--bg)";
    root.style.setProperty("--surface-solid", theme === "dark" ? "#181d28" : "#ffffff");
  }

  // 同步设置面板控件
  syncSettingsUI();
}

function syncSettingsUI() {
  const s = S.settings;
  $$("#seg-theme button").forEach(b => b.classList.toggle("on", b.dataset.v === s.theme));
  $$("#seg-bg button").forEach(b => b.classList.toggle("on", b.dataset.v === s.bgType));
  $$("#swatches .sw").forEach(b => b.classList.toggle("on", b.dataset.c === s.accent));
  $$("#bg-grad-opts .grad").forEach((g, i) => g.classList.toggle("on", i === s.bgGrad));
  $("#bg-grad-opts").classList.toggle("hidden", s.bgType !== "grad");
  $("#bg-solid-opts").classList.toggle("hidden", s.bgType !== "solid");
  $("#bg-image-opts").classList.toggle("hidden", s.bgType !== "image");
  $("#bg-color").value = s.bgSolid;
  $("#bg-url").value = s.bgUrl;
  $("#bg-dim").value = s.bgDim; $("#bg-dim-v").textContent = s.bgDim + "%";
  $("#bg-blur").value = s.bgBlur; $("#bg-blur-v").textContent = s.bgBlur + "px";
  $("#bg-fit").value = s.bgFit;
  $("#font-size").value = s.fontSize; $("#font-size-v").textContent = s.fontSize + "px";
  $("#radius").value = s.radius; $("#radius-v").textContent = s.radius + "px";
  $("#chat-width").value = s.chatWidth; $("#chat-width-v").textContent = s.chatWidth + "px";
  $("#anim-on").checked = s.anim;
  $("#blur-on").checked = s.blur;
  const rb = $("#btn-rag");
  if (rb) rb.classList.toggle("on", !!s.ragOn);
  $("#set-host").value = s.host;
  $("#set-dir").value = s.modelsDir;
  $("#set-keep").value = s.keepAlive;
  $("#set-max").value = s.maxLoaded;
  $("#net-fetch-on").checked = s.netFetch;
  $("#cloud-base").value = s.cloudBase;
  $("#cloud-key").value = s.cloudKey;
  $("#cloud-model").value = s.cloudModel;
  $("#cloud-on").checked = s.cloudOn;
}

async function saveSettings() {
  applySettings();
  try { await api.post("/api/settings", S.settings); } catch (e) {}
  try { localStorage.setItem("lai.settings", JSON.stringify(S.settings)); } catch (e) {}
}

/* ==================== 渲染：侧栏 ==================== */

function renderConvs() {
  const kw = ($("#conv-search").value || "").trim().toLowerCase();
  const list = $("#conv-list");
  list.innerHTML = "";
  const items = S.convs.filter(c => !kw || c.title.toLowerCase().includes(kw));
  if (!items.length) {
    list.appendChild(el("div", "conv-empty", kw ? "没有匹配的对话" : "还没有对话，点上面新建一个"));
    return;
  }
  items.forEach((c, i) => {
    const d = el("div", "conv" + (c.id === S.curId ? " on" : ""));
    d.style.animationDelay = Math.min(i * 22, 220) + "ms";
    d.innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;flex:0 0 14px;opacity:.6"><path d="M21 12a8 8 0 01-8 8H7l-4 3 1-5a8 8 0 1117-6z" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>
      <span class="t">${esc(c.title)}</span>
      <span class="x" title="删除"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
    d.onclick = e => {
      if (e.target.closest(".x")) { delConv(c.id); return; }
      S.curId = c.id; store.save(); renderConvs(); renderChat();
      if (innerWidth <= 900) document.body.classList.remove("sb-open");
    };
    list.appendChild(d);
  });
}

async function delConv(id) {
  const c = S.convs.find(x => x.id === id);
  if (!c) return;
  if (!(await ask("删除对话", `确定删除「${c.title}」？`))) return;
  S.convs = S.convs.filter(x => x.id !== id);
  if (S.curId === id) S.curId = S.convs[0] ? S.convs[0].id : null;
  store.save(); renderConvs(); renderChat();
  toast("已删除");
}

/* ==================== 渲染：对话 ==================== */

function msgNode(m, animate) {
  const isUser = m.role === "user";
  const wrap = el("div", "msg " + (isUser ? "user" : "ai"));
  if (!animate) wrap.style.animation = "none";
  wrap.innerHTML = `<div class="av">${isUser ? "我" : "AI"}</div>
    <div class="bd">
      <div class="who">${isUser ? "你" : esc(m.model || $("#sel-model").value || "AI")}</div>
      <div class="think" style="display:none"><summary>思考过程</summary><div class="ti"></div></div>
      <div class="bubble"><div class="content"></div></div>
      <div class="meta" style="display:none"></div>
      <div class="msg-foot"></div>
    </div>`;
  const bubble = $(".content", wrap);
  if (m.thinking) {
    const th = $(".think", wrap);
    th.style.display = "";
    $(".ti", th).textContent = m.thinking;
  }
  bubble.innerHTML = mdRender(m.content || "");
  if (m.stats && m.stats.text) {
    const meta = $(".meta", wrap);
    meta.style.display = "";
    meta.innerHTML = m.stats.text;
  }
  const foot = $(".msg-foot", wrap);
  if (!isUser && m.content) {
    const b1 = el("button", null, "复制");
    b1.onclick = () => { navigator.clipboard.writeText(m.content); toast("已复制", "ok"); };
    const b2 = el("button", null, "重新生成");
    b2.onclick = () => regenerate(m);
    const b3 = el("button", null, "删除");
    b3.onclick = () => {
      const c = cur(); if (!c) return;
      c.messages = c.messages.filter(x => x !== m);
      store.save(); renderChat();
    };
    foot.append(b1, b2, b3);
  }
  return wrap;
}

function renderChat() {
  const c = cur();
  const box = $("#chat");
  box.innerHTML = "";
  const w = $("#welcome");
  if (!c || !c.messages.length) {
    w.classList.remove("hidden");
    return;
  }
  w.classList.add("hidden");
  c.messages.forEach(m => box.appendChild(msgNode(m, false)));
  scrollBottom(false);
}

function scrollBottom(smooth) {
  const s = $("#chat-scroll");
  s.scrollTo({ top: s.scrollHeight, behavior: smooth === false ? "auto" : "smooth" });
}

/* ==================== 发送与流式生成 ==================== */

function buildContext() {
  let extra = "";
  if (S.attachments.length) {
    extra = "\n\n[以下是用户提供的网页内容，请据此回答]\n" +
      S.attachments.map(a => `《${a.title}》(${a.url})\n${a.text}`).join("\n\n---\n\n");
  }
  return extra;
}

async function send() {
  if (S.streaming) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text && !S.attachments.length) return;

  let c = cur();
  if (!c) c = newConv($("#sel-model").value);

  const model = S.cloudMode ? (S.settings.cloudModel || "cloud") : $("#sel-model").value;

  // 本地知识库检索：命中的片段会被拼进这次提问的上下文
  let rag = null;
  if (S.settings.ragOn && S.settings.ragKb) {
    const hintEl = $("#comp-hint");
    const old = hintEl.innerHTML;
    hintEl.innerHTML = "<span>正在检索本地知识库…</span>";
    rag = await kbRetrieve(text);
    hintEl.innerHTML = old;
  }
  const full = text + buildContext() + ((rag && rag.context) || "");

  c.messages.push({ role: "user", content: full });
  if (c.title === "新对话" || c.messages.length === 1) {
    c.title = (text || "网页内容").replace(/\n/g, " ").slice(0, 18) || "新对话";
  }
  if (!c.model) c.model = model;
  S.attachments = [];
  renderAttach();
  input.value = ""; autoGrow();
  store.save(); renderConvs(); renderChat();

  await generate(c, model, (rag && rag.hits) ? rag.hits : []);
}

async function generate(c, model, sources) {
  S.streaming = true;
  document.body.classList.add("generating");
  $("#welcome").classList.add("hidden");

  const node = msgNode({ role: "assistant", content: "", model }, true);
  // 展示这次回答依据了知识库里的哪些来源
  if (sources && sources.length) {
    const row = el("div", "src-row");
    row.innerHTML = '<span class="src-label">依据</span>' + sources.map(h =>
      `<span class="src-chip" title="${esc((h.text || "").slice(0, 160))}">${esc(h.source)} · ${h.score}</span>`
    ).join("");
    const bd = $(".bd", node);
    bd.insertBefore(row, $(".bubble", node));
  }
  $("#chat").appendChild(node);
  const bubble = $(".content", node);
  const thinkBox = $(".think", node);
  const thinkInner = $(".ti", node);
  bubble.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  scrollBottom();

  let acc = "", thinkAcc = "", t0 = performance.now(), final = null, lastPaint = 0;

  const paint = force => {
    const now = performance.now();
    if (!force && now - lastPaint < 90) return;
    lastPaint = now;
    bubble.innerHTML = acc ? mdRender(acc) : "";
    if (acc) {
      const caret = el("span", "caret");
      bubble.appendChild(caret);
    }
    scrollBottom();
  };

  try {
    if (S.cloudMode) {
      await streamCloud(c, model, chunk => { acc += chunk; paint(); }, th => {
        thinkAcc += th;
        thinkBox.style.display = "";
        thinkInner.textContent = thinkAcc;
        thinkInner.scrollTop = thinkInner.scrollHeight;
      });
    } else {
      const msgs = c.sys ? [{ role: "system", content: c.sys }] : [];
      msgs.push(...c.messages.slice(-20));
      const payload = {
        model, messages: msgs, stream: true,
        options: {
          temperature: +c.params.temperature, top_p: +c.params.top_p,
          num_ctx: Math.round(c.params.num_ctx), num_predict: Math.round(c.params.num_predict),
          num_thread: Math.round(c.params.num_thread),
        },
      };
      S.ctrl = new AbortController();
      for await (const o of api.stream("/proxy/api/chat", payload)) {
        if (o.error) throw new Error(o.error);
        const m = o.message || {};
        if (m.thinking) {
          thinkAcc += m.thinking;
          thinkBox.style.display = "";
          thinkInner.textContent = thinkAcc;
        }
        if (m.content) { acc += m.content; paint(); }
        if (o.done) final = o;
      }
    }
    paint(true);
    if (!$(".caret", bubble) && acc === "") {
      bubble.innerHTML = '<p style="color:var(--warn)">[模型没有输出正式回答，可提高「最多生成」或查看思考过程]</p>';
    } else {
      const caret = $(".caret", bubble); if (caret) caret.remove();
    }

    const wall = (performance.now() - t0) / 1000;
    let statsText = "";
    if (final) {
      const ev = final.eval_count || 0, gd = (final.eval_duration || 0) / 1e9;
      const tps = gd > 0 ? (ev / gd) : 0;
      statsText = `<span>${ev} tokens</span><span>${tps.toFixed(1)} tok/s</span><span>用时 ${wall.toFixed(1)}s</span>`;
    } else if (S.cloudMode) {
      statsText = `<span>云端</span><span>用时 ${wall.toFixed(1)}s</span>`;
    } else {
      statsText = `<span>已停止</span><span>用时 ${wall.toFixed(1)}s</span>`;
    }
    const meta = $(".meta", node);
    meta.style.display = ""; meta.innerHTML = statsText;

    c.messages.push({ role: "assistant", content: acc, thinking: thinkAcc, model,
                      stats: { text: statsText } });
    store.save();

    const foot = $(".msg-foot", node);
    const b1 = el("button", null, "复制");
    b1.onclick = () => { navigator.clipboard.writeText(acc); toast("已复制", "ok"); };
    const b2 = el("button", null, "重新生成");
    b2.onclick = () => regenerate(c.messages[c.messages.length - 1]);
    const b3 = el("button", null, "删除");
    b3.onclick = () => {
      c.messages = c.messages.filter(x => x !== c.messages[c.messages.length - 1]);
      store.save(); renderChat();
    };
    foot.append(b1, b2, b3);

  } catch (e) {
    bubble.innerHTML = mdRender(acc) + `<p style="color:var(--err)">[错误] ${esc(e.message || e)}</p>`;
    toast("生成失败：" + (e.message || e), "err");
  } finally {
    S.streaming = false; S.ctrl = null;
    document.body.classList.remove("generating");
    $("#input").focus();
  }
}

async function streamCloud(c, model, onDelta, onThink) {
  const msgs = c.sys ? [{ role: "system", content: c.sys }] : [];
  msgs.push(...c.messages.slice(-20));
  for await (const o of api.stream("/api/cloud/chat", { messages: msgs, model })) {
    if (o.error) throw new Error(o.error);
    const d = (o.choices && o.choices[0] && o.choices[0].delta) || {};
    const rc = d.reasoning_content || d.reasoning;
    if (rc && onThink) onThink(rc);
    if (d.content) onDelta(d.content);
  }
}

function regenerate(msg) {
  const c = cur(); if (!c || S.streaming) return;
  const idx = c.messages.indexOf(msg);
  if (idx < 0) return;
  // 删掉这条回答及其之后的内容，重新生成
  c.messages = c.messages.slice(0, idx);
  store.save(); renderChat();
  const userMsg = c.messages[c.messages.length - 1];
  if (!userMsg) return;
  generate(c, S.cloudMode ? (S.settings.cloudModel || "cloud") : ($("#sel-model").value || c.model));
}

function stopGen() {
  if (S.ctrl) { try { S.ctrl.abort(); } catch (e) {} }
  S.streaming = false;
}

/* ==================== 附件（联网读取） ==================== */

function renderAttach() {
  const row = $("#attach-row");
  row.innerHTML = "";
  S.attachments.forEach((a, i) => {
    const d = el("div", "attach");
    d.innerHTML = `<svg viewBox="0 0 24 24" style="width:13px;height:13px"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      <span class="an">${esc(a.title || a.url)}</span><span class="ax">×</span>`;
    $(".ax", d).onclick = () => { S.attachments.splice(i, 1); renderAttach(); };
    row.appendChild(d);
  });
  updateHint();
}

async function fetchUrl() {
  if (!S.settings.netFetch) { toast("已关闭联网读取，请在设置里开启", "err"); return; }
  const url = await ask("读取网页", "输入网址，服务器会抓取正文并交给模型分析", "https://");
  if (!url || url === "https://") return;
  toast("正在抓取…");
  try {
    const r = await api.post("/api/net/fetch", { url });
    if (r.error) throw new Error(r.error);
    S.attachments.push(r);
    renderAttach();
    toast(`已读取《${r.title}》${r.text.length} 字`, "ok");
  } catch (e) {
    toast("抓取失败：" + (e.message || e), "err");
  }
}

/* ==================== 模型列表 ==================== */

async function loadModels() {
  try {
    const d = await api.get("/proxy/api/tags");
    S.models = (d.models || []).sort((a, b) => (b.size || 0) - (a.size || 0));
    const sel = $("#sel-model");
    const prev = sel.value || (S.settings.lastModel || "");
    sel.innerHTML = "";
    S.modelsInfo = {};
    S.models.forEach(m => {
      S.modelsInfo[m.name] = m;
      const o = el("option");
      o.value = m.name;
      o.textContent = `${m.name}  ·  ${fmtGB((m.size || 0) / 1e9)}`;
      sel.appendChild(o);
    });
    if (!S.models.length) {
      sel.innerHTML = '<option value="">（还没有模型，去模型市场下载）</option>';
    } else if (prev && S.models.some(m => m.name === prev)) {
      sel.value = prev;
    }
    const base = $("#new-base");
    base.innerHTML = S.models.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("");
    renderInstalled();
    return true;
  } catch (e) {
    $("#status-dot").className = "dot off";
    $("#status-text").textContent = "后端未连接";
    $("#status-sub").textContent = String(e.message || e);
    return false;
  }
}

/* ==================== 模型市场 ==================== */

function renderMarket() {
  const kw = ($("#market-search").value || "").trim().toLowerCase();
  const cat = $("#market-cat").value;
  const grid = $("#market-grid");
  const installed = new Set(S.models.map(m => m.name));
  grid.innerHTML = "";

  const avail = (S.status && S.status.mem && S.status.mem.avail) || 0;

  CATALOG.filter(([name, , , c, desc]) =>
    (cat === "全部" || c === cat) &&
    (!kw || name.toLowerCase().includes(kw) || desc.toLowerCase().includes(kw))
  ).forEach(([name, params, size, c, desc], i) => {
    const isIn = installed.has(name);
    const need = size + 0.4;
    let fit, cls;
    if (!avail) { fit = "未知"; cls = ""; }
    else if (need <= avail * 0.7) { fit = "✅ 推荐"; cls = "ok"; }
    else if (need <= avail) { fit = "⚠ 勉强"; cls = "warn"; }
    else { fit = "❌ 内存不足"; cls = "err"; }

    const st = S.marketState[name];
    const card = el("div", "model-card");
    card.style.animationDelay = Math.min(i * 18, 300) + "ms";
    card.innerHTML = `
      <div class="mc-head">
        <span class="mc-name">${esc(name)}</span>
        ${isIn ? '<span class="mc-badge inst">已安装</span>' : `<span class="mc-badge ${cls}">${fit}</span>`}
      </div>
      <div class="mc-meta"><span>${params} 参数</span><span>${fmtGB(size)}</span><span>需 ${fmtGB(need)} 内存</span><span>${c}</span></div>
      <div class="mc-desc">${esc(desc)}</div>
      <div class="mc-prog${st && st.running ? " on" : ""}">
        <div class="mc-bar"><i style="width:${(st && st.pct) || 0}%"></i></div>
        <div class="mc-ptxt">${st ? esc(st.text || "") : ""}</div>
      </div>
      <div class="mc-actions">
        <button class="btn ${isIn ? "" : "primary"}" data-act="${isIn ? "del" : "pull"}">${isIn ? "删除模型" : "下载并部署"}</button>
        ${st && st.running ? '<button class="btn danger" data-act="cancel">取消</button>' : ""}
      </div>`;
    $("[data-act]", card).onclick = () => (isIn ? delModel(name) : pullModel(name, card));
    const cc = $('[data-act="cancel"]', card);
    if (cc) cc.onclick = () => { S.marketState[name].cancel = true; };
    grid.appendChild(card);
  });
}

async function pullModel(name, card) {
  if (S.marketState[name] && S.marketState[name].running) return;
  S.marketState[name] = { running: true, pct: 0, text: "准备中…", cancel: false };
  renderMarket();
  const prog = () => $(".mc-prog", $(".model-card", $("#market-grid")));
  let last = { c: 0, t: 0, ts: performance.now() };

  try {
    for await (const o of api.stream("/proxy/api/pull", { model: name, stream: true })) {
      const st = S.marketState[name];
      if (!st) break;
      if (st.cancel) { st.text = "已取消"; break; }
      if (o.error) throw new Error(o.error);
      if (o.digest && o.total) {
        const now = performance.now();
        const dt = (now - last.ts) / 1000;
        const inst = dt > 0 ? (o.completed - last.c) / dt : 0;
        last = { c: o.completed, t: o.total, ts: now };
        const pct = o.total ? (o.completed / o.total * 100) : 0;
        const remain = inst > 0 ? (o.total - o.completed) / inst : 0;
        st.pct = pct;
        st.text = `${fmtGB(o.completed / 1e9)}  ${pct.toFixed(1)}%  ${fmtGB(inst / 1e9)}/s  剩余 ${remain > 0 ? Math.floor(remain / 60) + ":" + String(Math.floor(remain % 60)).padStart(2, "0") : "--"}`;
      } else if (o.status) {
        st.text = { "pulling manifest": "获取清单…", "verifying sha256 digest": "校验中…",
                    "writing manifest": "写入清单…", "removing any unused layers": "清理旧层…",
                    success: "完成" }[o.status] || o.status;
      }
      renderMarket();
    }
    S.marketState[name] = { running: false, pct: 100, text: "完成" };
    toast(`${name} 下载完成`, "ok");
    await loadModels();
  } catch (e) {
    S.marketState[name] = { running: false, pct: 0, text: "失败：" + (e.message || e) };
    toast("下载失败：" + (e.message || e), "err");
  }
  renderMarket();
}

async function delModel(name) {
  if (!(await ask("删除模型", `确定删除 ${name}？会释放磁盘空间。`))) return;
  try {
    await api.post("/proxy/api/delete", { model: name });
    toast("已删除 " + name, "ok");
    await loadModels(); renderMarket();
  } catch (e) {
    toast("删除失败：" + (e.message || e), "err");
  }
}

/* ==================== 模型配置 ==================== */

function renderInstalled() {
  const box = $("#installed-list");
  box.innerHTML = "";
  if (!S.models.length) { box.innerHTML = '<div class="conv-empty">还没有已安装的模型</div>'; return; }
  S.models.forEach(m => {
    const d = el("div", "li" + (m.name === ($("#sel-model").value) ? " on" : ""));
    d.innerHTML = `<span class="n">${esc(m.name)}</span><span class="s">${fmtGB((m.size || 0) / 1e9)}</span>`;
    d.onclick = () => showModelDetail(m.name);
    box.appendChild(d);
  });
}

async function showModelDetail(name) {
  $$("#installed-list .li").forEach(x => x.classList.toggle("on", $(".n", x).textContent === name));
  $("#model-detail").textContent = "读取中…";
  try {
    const d = await api.post("/proxy/api/show", { model: name });
    const de = d.details || {};
    const lines = [
      `模型    ${name}`,
      `参数量  ${de.parameter_size || "?"}`,
      `量化    ${de.quantization_level || "?"}`,
      `家族    ${de.family || "?"}`,
      `上下文  ${de.context_length || "?"}`,
      `格式    ${de.format || "?"}`,
      "",
      "— 系统提示词 —",
      d.system || "(无)",
      "",
      "— 参数 —",
      d.parameters || "(默认)",
    ];
    $("#model-detail").textContent = lines.join("\n");
    S._detailModel = name;
  } catch (e) {
    $("#model-detail").textContent = "读取失败：" + (e.message || e);
  }
}

async function createModel() {
  const name = $("#new-name").value.trim();
  const base = $("#new-base").value;
  if (!name) { toast("请填写新模型名", "err"); return; }
  if (!base) { toast("请选择基础模型", "err"); return; }
  const sys = $("#new-sys").value.trim();
  $("#create-hint").textContent = "创建中…";
  try {
    const payload = { model: name, from: base, stream: false,
                      parameters: Object.assign({}, S.settings.params) };
    if (sys) payload.system = sys;
    await api.post("/proxy/api/create", payload);
    toast(`已创建 ${name}`, "ok");
    $("#new-name").value = ""; $("#new-sys").value = "";
    await loadModels();
  } catch (e) {
    toast("创建失败：" + (e.message || e), "err");
  }
  $("#create-hint").textContent = "";
}

/* ==================== 面板 ==================== */

function openPanel(name) {
  closePanels();
  const p = $("#panel-" + name);
  if (!p) return;
  document.body.classList.add("panel-open");
  requestAnimationFrame(() => p.classList.add("open"));
  if (name === "market") { renderMarket(); refreshStatus(); }
  if (name === "models") { renderInstalled(); }
  if (name === "settings") { syncSettingsUI(); fillAbout(); }
  if (name === "kb") { kbLoad(); }
}
function closePanels() {
  $$(".panel").forEach(p => p.classList.remove("open"));
  document.body.classList.remove("panel-open");
}

/* ==================== 状态与联网检测 ==================== */

async function refreshStatus() {
  try {
    const st = await api.get("/api/status");
    S.status = st;
    const dot = $("#status-dot");
    if (st.ollama && st.ollama.ok) {
      dot.className = "dot on";
      $("#status-text").textContent = "后端运行中";
      $("#status-sub").textContent = "Ollama v" + st.ollama.version;
    } else {
      dot.className = "dot off";
      $("#status-text").textContent = "后端未运行";
      $("#status-sub").textContent = "点右上角「重启后端」";
    }
    S.online = !!st.online;
    $("#net-dot").className = "net-dot " + (st.online ? "on" : "off");
    $("#net-text").textContent = st.online ? `已联网 (${st.latency || 0} ms)` : "未联网（离线模式）";
    if (st.mem) {
      const m = `内存 可用 ${st.mem.avail.toFixed(1)} / ${st.mem.total.toFixed(1)} GB`;
      const d = st.disk_free ? `  模型目录剩余 ${st.disk_free.toFixed(1)} GB` : "";
      $("#comp-hint").innerHTML = `<span>${esc(m + d)}</span>`;
    }
    if (S.settings && !S.settings.modelsDir && st.models_dir) {
      S.settings.modelsDir = st.models_dir;
    }
    $("#market-sub").textContent = `共 ${CATALOG.length} 个可选 · 已装 ${S.models.length} 个 · 可用内存 ${st.mem ? st.mem.avail.toFixed(1) : "?"} GB`;
    return st;
  } catch (e) {
    $("#status-dot").className = "dot off";
    $("#status-text").textContent = "服务异常";
    $("#status-sub").textContent = String(e.message || e);
  }
}

async function checkNet() {
  toast("正在检测网络…");
  await refreshStatus();
  toast(S.online ? "网络正常" : "当前无法联网", S.online ? "ok" : "err");
}

/* ==================== 其他 ==================== */

function autoGrow() {
  const t = $("#input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 210) + "px";
}

function updateHint() {
  const parts = ["Enter 发送 · Shift+Enter 换行"];
  if (S.cloudMode) parts.push("当前：云端模型");
  else parts.push("当前：本地模型");
  if (S.attachments.length) parts.push(`已附加 ${S.attachments.length} 个网页`);
  const h = $("#comp-hint");
  const mem = h.querySelector("span");
  const memTxt = mem ? mem.outerHTML : "";
  h.innerHTML = memTxt + parts.map(p => `<span>${esc(p)}</span>`).join("");
}

function exportMd() {
  const c = cur();
  if (!c || !c.messages.length) { toast("当前对话还没有内容", "err"); return; }
  const L = [`# ${c.title}`, "", `- 模型：\`${c.model || "?"}\``,
             `- 时间：${new Date(c.created).toLocaleString()}`, ""];
  if (c.sys) L.push(`> 系统提示词：${c.sys}`, "");
  c.messages.forEach(m => {
    L.push(`## ${m.role === "user" ? "你" : "模型"}`, "", m.content, "");
  });
  const blob = new Blob([L.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (c.title.replace(/[\\/:*?"<>|]/g, "_") || "conversation") + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("已导出", "ok");
}

/* ==================== 本地知识库（RAG） ==================== */

const KB = { list: [], cur: null };

async function kbLoad() {
  try {
    const d = await api.get("/api/kb/list");
    KB.list = d.kbs || [];
    if (d.embedModel) S.settings.embedModel = d.embedModel;
    if (KB.cur && !KB.list.some(k => k.id === KB.cur.id)) KB.cur = null;
    if (!KB.cur && KB.list.length) KB.cur = KB.list[0];
    kbRenderList();
  } catch (e) { toast("读取知识库失败：" + (e.message || e), "err"); }
}

function kbRenderList() {
  const box = $("#kb-list");
  box.innerHTML = "";
  $("#kb-sub").textContent = KB.list.length
    ? `${KB.list.length} 个知识库 · 嵌入模型 ${S.settings.embedModel || "?"}`
    : `还没有知识库 · 嵌入模型 ${S.settings.embedModel || "?"}`;
  if (!KB.list.length) {
    box.innerHTML = '<div class="conv-empty">点上面「新建知识库」开始</div>';
    $("#kb-title").textContent = "请选择或新建一个知识库";
    $("#kb-stats").textContent = "";
    $("#kb-sources").innerHTML = "";
    return;
  }
  KB.list.forEach(k => {
    const d = el("div", "li" + (KB.cur && KB.cur.id === k.id ? " on" : ""));
    d.innerHTML = `<span class="n">${esc(k.name)}</span><span class="s">${k.chunks} 段</span>`;
    d.onclick = () => { KB.cur = k; kbRenderList(); };
    box.appendChild(d);
  });
  kbRenderDetail();
}

function kbRenderDetail() {
  const k = KB.cur;
  if (!k) return;
  $("#kb-title").textContent = k.name;
  $("#kb-stats").textContent =
    `${k.chunks} 个片段 · ${(k.sources || []).length} 个来源 · ${k.dims || "?"} 维 · ${k.model || "?"}`;
  const box = $("#kb-sources");
  box.innerHTML = "";
  const srcs = k.sources || [];
  if (!srcs.length) { box.innerHTML = '<div class="conv-empty">还没有导入任何文件</div>'; }
  else srcs.forEach(s => {
    const d = el("div", "li");
    d.innerHTML = `<span class="n">${esc(s)}</span>`;
    box.appendChild(d);
  });
  S.settings.ragKb = k.id;
  saveSettings();
}

async function kbNew() {
  const name = await ask("新建知识库", "给知识库起个名字，比如「信奥模板」", "我的资料");
  if (!name) return;
  try {
    const r = await api.post("/api/kb/create", { name });
    KB.cur = { id: r.id };
    toast("已创建：" + name, "ok");
    await kbLoad();
  } catch (e) { toast("创建失败：" + (e.message || e), "err"); }
}

async function kbDelete() {
  if (!KB.cur) { toast("请先选择一个知识库", "err"); return; }
  if (!(await ask("删除知识库", `确定删除「${KB.cur.name || KB.cur.id}」？索引文件会一并删除。`))) return;
  try {
    await api.post("/api/kb/delete", { id: KB.cur.id });
    KB.cur = null;
    toast("已删除", "ok");
    await kbLoad();
  } catch (e) { toast("删除失败：" + (e.message || e), "err"); }
}

function kbUpload() {
  if (!KB.cur) { toast("请先新建或选择一个知识库", "err"); return; }
  $("#kb-file").click();
}

async function kbFilesPicked(files) {
  if (!files || !files.length) return;
  const kid = KB.cur.id;
  const payload = [];
  let skipped = 0;
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { skipped++; continue; }
    try { payload.push({ name: f.name, text: await f.text() }); } catch (e) { skipped++; }
  }
  if (!payload.length) { $("#kb-progress").textContent = "没有可导入的文件"; return; }
  $("#kb-progress").textContent =
    `正在建立索引（${payload.length} 个文件${skipped ? "，跳过 " + skipped + " 个" : ""}）…首次会加载嵌入模型，请稍候`;
  try {
    const r = await api.post("/api/kb/add", { id: kid, files: payload });
    $("#kb-progress").textContent =
      `完成：新增 ${r.chunks} 个片段${r.message ? "（" + r.message + "）" : ""}`;
    toast(`已索引 ${r.chunks} 个片段`, "ok");
    await kbLoad();
  } catch (e) {
    $("#kb-progress").textContent = "";
    toast("入库失败：" + (e.message || e), "err");
  }
}

async function kbScan() {
  if (!KB.cur) { toast("请先选择知识库", "err"); return; }
  const path = await ask("扫描目录",
    "输入文件夹路径，会递归导入其中的文本与代码文件（自动跳过 .git / node_modules 等）",
    "E:\\depseekbushu");
  if (!path) return;
  const kid = KB.cur.id;
  $("#kb-progress").textContent = "正在扫描并建立索引…文件多时请耐心等待，不要关窗口";
  try {
    const r = await api.post("/api/kb/scan", { id: kid, path });
    $("#kb-progress").textContent =
      `完成：${r.files} 个文件 / ${r.chunks} 个片段` +
      (r.errors && r.errors.length ? `（${r.errors.length} 个失败）` : "");
    toast(`已导入 ${r.files} 个文件`, "ok");
    await kbLoad();
  } catch (e) {
    $("#kb-progress").textContent = "";
    toast("扫描失败：" + (e.message || e), "err");
  }
}

async function kbTest() {
  if (!KB.cur) { toast("请先选择知识库", "err"); return; }
  const q = $("#kb-q").value.trim();
  if (!q) return;
  const box = $("#kb-hits");
  box.innerHTML = '<div class="hint" style="margin-top:10px">检索中…</div>';
  try {
    const r = await api.post("/api/kb/search", { id: KB.cur.id, query: q, top_k: 5 });
    if (!r.hits || !r.hits.length) {
      box.innerHTML = '<div class="hint" style="margin-top:10px">没有检索到相关内容（相似度都低于阈值）</div>';
      return;
    }
    box.innerHTML = "";
    r.hits.forEach(h => {
      const d = el("div", "hit");
      d.innerHTML = `<div class="hit-h"><b>${esc(h.source)}</b><span>相似度 ${h.score}</span></div>
                     <div class="hit-t">${esc(h.text.slice(0, 420))}${h.text.length > 420 ? " …" : ""}</div>`;
      box.appendChild(d);
    });
  } catch (e) {
    box.innerHTML = `<div class="hint" style="margin-top:10px;color:var(--err)">${esc(e.message || e)}</div>`;
  }
}

async function kbRetrieve(query) {
  if (!S.settings.ragOn || !S.settings.ragKb || !query) return null;
  try {
    return await api.post("/api/kb/search",
      { id: S.settings.ragKb, query, top_k: S.settings.ragTopK || 5 });
  } catch (e) { return null; }
}

/* ==================== 初始化 ==================== */

async function fillAbout() {
  try {
    const a = await api.get("/api/about");
    $("#about-info").textContent = Object.entries(a).map(([k, v]) => `${k.padEnd(14)} ${v}`).join("\n");
  } catch (e) { $("#about-info").textContent = "读取失败：" + e.message; }
}

function bindUI() {
  // 侧栏
  $("#btn-new").onclick = () => { if (S.streaming) return; newConv($("#sel-model").value); renderConvs(); renderChat(); $("#input").focus(); };
  $("#btn-collapse").onclick = () => document.body.classList.toggle("sb-collapsed");
  $("#btn-menu").onclick = () => document.body.classList.toggle("sb-open");
  $("#conv-search").oninput = renderConvs;
  $$(".sb-nav button").forEach(b => b.onclick = () => openPanel(b.dataset.panel));

  // 顶栏
  $("#sel-model").onchange = () => {
    const c = cur(); if (c) { c.model = $("#sel-model").value; store.save(); }
    S.settings.lastModel = $("#sel-model").value; saveSettings();
    renderInstalled();
  };
  $("#btn-theme").onclick = () => {
    const order = ["dark", "light", "auto"];
    S.settings.theme = order[(order.indexOf(S.settings.theme) + 1) % 3];
    saveSettings();
    toast("主题：" + ({ dark: "深色", light: "浅色", auto: "跟随系统" }[S.settings.theme]));
  };
  $("#btn-bg").onclick = () => openPanel("settings");
  $("#btn-export").onclick = exportMd;
  $("#chip-cloud").onclick = () => {
    if (!S.settings.cloudOn || !S.settings.cloudBase || !S.settings.cloudKey) {
      toast("请先在「设置 → 后端与联网」里配置云端 API", "err");
      openPanel("settings"); switchTab("back"); return;
    }
    S.cloudMode = !S.cloudMode;
    $("#chip-cloud").classList.toggle("cloud", S.cloudMode);
    $("#chip-cloud").lastChild.textContent = S.cloudMode ? " 云端" : " 本地";
    updateHint();
    toast(S.cloudMode ? "已切换到云端模型" : "已切回本地模型");
  };

  // 输入
  const inp = $("#input");
  inp.addEventListener("input", () => { autoGrow(); $("#counter").textContent = inp.value.length ? inp.value.length + " 字" : ""; });
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $("#btn-send").onclick = send;
  $("#btn-stop").onclick = stopGen;
  $("#btn-url").onclick = fetchUrl;
  $("#btn-rag").onclick = function () {
    if (!S.settings.ragKb) {
      toast("请先在「本地知识库」里新建并导入资料", "err");
      openPanel("kb");
      return;
    }
    S.settings.ragOn = !S.settings.ragOn;
    this.classList.toggle("on", S.settings.ragOn);
    saveSettings();
    toast(S.settings.ragOn ? "已开启知识库检索，回答将优先依据资料" : "已关闭知识库检索");
    updateHint();
  };
  $("#kb-new").onclick = kbNew;
  $("#kb-del").onclick = kbDelete;
  $("#kb-refresh").onclick = kbLoad;
  $("#kb-upload").onclick = kbUpload;
  $("#kb-scan").onclick = kbScan;
  $("#kb-test").onclick = kbTest;
  $("#kb-file").onchange = e => { kbFilesPicked(e.target.files); e.target.value = ""; };
  $("#kb-q").onkeydown = e => { if (e.key === "Enter") kbTest(); };
  $("#btn-think").onclick = function () {
    this.classList.toggle("on");
    const show = this.classList.contains("on");
    $$("#chat .think").forEach(t => { if (!t.dataset.user) t.open = show; });
  };

  // 欢迎卡片
  const wc = $("#w-cards");
  WELCOME_CARDS.forEach(([t, q], i) => {
    const d = el("div", "w-card");
    d.style.animationDelay = (i * 60) + "ms";
    d.innerHTML = `<b>${esc(t)}</b><span>${esc(q)}</span>`;
    d.onclick = () => { $("#input").value = q; autoGrow(); send(); };
    wc.appendChild(d);
  });

  // 面板关闭
  $("#mask").onclick = closePanels;
  $$("[data-close]").forEach(b => b.onclick = closePanels);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closePanels(); stopGen(); }
    if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); $("#btn-new").click(); }
    if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); exportMd(); }
  });

  // 代码复制（事件委托）
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-copy]");
    if (b) {
      const code = $("code", b.closest(".code-wrap"));
      if (code) { navigator.clipboard.writeText(code.textContent); toast("代码已复制", "ok"); }
    }
  });

  bindMarket(); bindSettings();
}

function bindMarket() {
  $("#market-search").oninput = renderMarket;
  const cat = $("#market-cat");
  CATS.forEach(c => cat.appendChild(new Option(c, c)));
  cat.onchange = renderMarket;
  $("#market-refresh").onclick = async () => { await loadModels(); await refreshStatus(); renderMarket(); toast("已刷新"); };
}

function switchTab(name) {
  $$("#set-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $$(".tab-pane").forEach(p => p.classList.toggle("hidden", p.dataset.pane !== name));
}

function bindSettings() {
  $$("#set-tabs button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

  // 主题
  $$("#seg-theme button").forEach(b => b.onclick = () => { S.settings.theme = b.dataset.v; saveSettings(); });
  // 强调色
  const sw = $("#swatches");
  ACCENTS.forEach(([c, n]) => {
    const d = el("div", "sw");
    d.style.background = c; d.dataset.c = c; d.title = n;
    d.onclick = () => { S.settings.accent = c; saveSettings(); };
    sw.appendChild(d);
  });
  // 渐变
  const gg = $("#bg-grad-opts");
  GRADIENTS.forEach(([g, n], i) => {
    const d = el("div", "grad");
    d.style.backgroundImage = g; d.title = n;
    d.onclick = () => { S.settings.bgType = "grad"; S.settings.bgGrad = i; saveSettings(); };
    gg.appendChild(d);
  });
  // 背景类型
  $$("#seg-bg button").forEach(b => b.onclick = () => { S.settings.bgType = b.dataset.v; saveSettings(); });
  $("#bg-color").oninput = e => { S.settings.bgType = "solid"; S.settings.bgSolid = e.target.value; saveSettings(); };
  $("#bg-dim").oninput = e => { S.settings.bgDim = +e.target.value; saveSettings(); };
  $("#bg-blur").oninput = e => { S.settings.bgBlur = +e.target.value; saveSettings(); };
  $("#bg-fit").onchange = e => { S.settings.bgFit = e.target.value; saveSettings(); };
  $("#btn-use-url").onclick = () => { S.settings.bgUrl = $("#bg-url").value.trim(); S.settings.bgType = "image"; saveSettings(); };
  $("#btn-pick-img").onclick = () => {
    const f = document.createElement("input");
    f.type = "file"; f.accept = "image/*";
    f.onchange = () => {
      const file = f.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => { S.settings.bgUrl = r.result; S.settings.bgType = "image"; saveSettings(); toast("背景已应用（本地图片存于浏览器）", "ok"); };
      r.readAsDataURL(file);
    };
    f.click();
  };
  // 外观
  $("#font-size").oninput = e => { S.settings.fontSize = +e.target.value; saveSettings(); };
  $("#radius").oninput = e => { S.settings.radius = +e.target.value; saveSettings(); };
  $("#chat-width").oninput = e => { S.settings.chatWidth = +e.target.value; saveSettings(); };
  $("#anim-on").onchange = e => { S.settings.anim = e.target.checked; saveSettings(); };
  $("#blur-on").onchange = e => { S.settings.blur = e.target.checked; saveSettings(); };

  // 参数
  const pl = $("#param-list");
  PARAM_SPEC.forEach(([k, label, lo, hi, step, isInt]) => {
    const wrap = el("label");
    wrap.innerHTML = `${label} <span id="pv_${k}" style="float:right;color:var(--fg-3)"></span>
      <input type="range" id="ps_${k}" min="${lo}" max="${hi}" step="${step}">`;
    pl.appendChild(wrap);
    const sl = $(`#ps_${k}`, wrap), pv = $(`#pv_${k}`, wrap);
    sl.value = S.settings.params[k];
    pv.textContent = isInt ? Math.round(S.settings.params[k]) : (+S.settings.params[k]).toFixed(2);
    sl.oninput = () => {
      S.settings.params[k] = +sl.value;
      pv.textContent = isInt ? Math.round(sl.value) : (+sl.value).toFixed(2);
      const c = cur(); if (c) c.params[k] = +sl.value;
      store.save();
    };
  });
  $("#btn-save-params").onclick = async () => { await saveSettings(); toast("参数已保存", "ok"); };

  // 后端与联网
  $("#btn-save-back").onclick = async () => {
    S.settings.host = $("#set-host").value.trim() || "127.0.0.1:11434";
    S.settings.modelsDir = $("#set-dir").value.trim();
    S.settings.keepAlive = $("#set-keep").value.trim() || "30m";
    S.settings.maxLoaded = $("#set-max").value.trim() || "1";
    await saveSettings();
    $("#back-hint").textContent = "正在重启后端…";
    try { await api.post("/api/backend/restart", {}); } catch (e) {}
    setTimeout(async () => { await refreshStatus(); await loadModels(); $("#back-hint").textContent = "后端已重启"; }, 4000);
  };
  $("#btn-open-dir").onclick = async () => { try { await api.post("/api/open-dir", {}); } catch (e) { toast("打开失败", "err"); } };
  $("#btn-save-net").onclick = async () => {
    S.settings.netFetch = $("#net-fetch-on").checked;
    S.settings.cloudBase = $("#cloud-base").value.trim();
    S.settings.cloudKey = $("#cloud-key").value.trim();
    S.settings.cloudModel = $("#cloud-model").value.trim();
    S.settings.cloudOn = $("#cloud-on").checked;
    await saveSettings();
    $("#net-hint").textContent = "已保存";
    setTimeout(() => $("#net-hint").textContent = "", 2000);
  };

  // 模型配置
  $("#models-refresh").onclick = async () => { await loadModels(); toast("已刷新"); };
  $("#btn-set-default").onclick = async () => {
    const n = S._detailModel; if (!n) { toast("请先选择一个模型", "err"); return; }
    S.settings.lastModel = n; $("#sel-model").value = n;
    await saveSettings(); toast(`已把 ${n} 设为默认`, "ok");
  };
  $("#btn-del-model").onclick = () => { const n = S._detailModel; if (n) delModel(n); };
  $("#btn-create").onclick = createModel;
  $("#btn-recheck").onclick = checkNet;
}

/* ---------- 生命周期上报 ----------
   不能用"浏览器进程是否退出"来判断用户关窗：Edge/Chrome 是单例的，
   启动器进程会立刻交接并退出。改由页面自己上报。 */
function bindLifecycle() {
  const bye = () => { try { navigator.sendBeacon("/api/quit"); } catch (e) {} };
  addEventListener("pagehide", bye);
  addEventListener("beforeunload", bye);
  window.addEventListener("unload", bye);
  // 心跳兜底（页面崩溃 / 强杀时用）。
  // 间隔取 8 秒：既能在关窗宽限期内撤销误判，又不至于被后台限流影响。
  const ping = () => fetch("/api/ping", { cache: "no-store" }).catch(() => {});
  ping();
  setInterval(ping, 8000);
  // 从后台切回前台时立刻补一次，避免定时器被限流后误判
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });
}

async function boot() {
  bindLifecycle();

  // 1) 先读本地缓存，界面立刻可用（避免白屏）
  try {
    const cached = JSON.parse(localStorage.getItem("lai.settings") || "null");
    if (cached) Object.assign(DEFAULT_SETTINGS, cached);
  } catch (e) {}
  S.settings = Object.assign({}, DEFAULT_SETTINGS);

  store.load();
  bindUI();
  applySettings();
  renderConvs();
  if (!S.convs.length) { $("#welcome").classList.remove("hidden"); }
  else {
    if (!cur()) S.curId = S.convs[0].id;
    renderChat();
  }
  updateHint();

  // 2) 再拉服务端设置
  try {
    const s = await api.get("/api/settings");
    if (s && typeof s === "object") Object.assign(S.settings, s);
    applySettings();
  } catch (e) {}

  // 3) 模型与状态
  await loadModels();
  await refreshStatus();
  setInterval(refreshStatus, 5000);

  // 4) 后端没起来就自动拉一次
  if (!S.models.length) {
    const ok = await loadModels();
    if (!ok) {
      try { await api.post("/api/backend/restart", {}); } catch (e) {}
      setTimeout(loadModels, 5000);
    }
  }
  $("#input").focus();
}

document.addEventListener("DOMContentLoaded", boot);
