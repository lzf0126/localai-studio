# 本地 AI 助手 · LocalAI Studio

> 一个**纯 Python 标准库**写的本地大模型桌面客户端 —— 现代 Web 界面，零第三方依赖，完全离线运行。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12-3776ab.svg)](https://www.python.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#技术上的几个取舍)

---

## 这是什么

一个 Windows 桌面程序，用主流 AI 软件的界面体验来管理和对话你**本机**部署的大模型。所有推理都在你自己的电脑上完成，**不联网、不上传任何内容**。

**它不包含模型，也不包含推理后端** —— 客户端只有约 12 MB，模型按需从 Ollama 官方仓库下载。

---

## 功能

| | |
|---|---|
| **对话** | 多会话管理、逐字流式输出、思考过程折叠、重新生成、复制、导出 Markdown |
| **模型市场** | 25 个精选模型，显示参数量 / 体积 / 所需内存 / **按当前可用内存实时计算的适配评级**；一键下载自动部署，带进度、速度、剩余时间，支持取消后断点续传 |
| **模型配置** | 模型详情（参数量 / 量化 / 上下文 / 对话模板）、设为默认、创建自定义模型、删除 |
| **本地知识库** | 导入你自己的文档建向量索引，提问时先检索再回答 —— **这是对本机小模型提升最大的功能** |
| **联网** | 网页正文抓取并注入上下文；可接任意 OpenAI 兼容接口做云端模型，一键本地/云端切换 |
| **个性化** | 深色/浅色/跟随系统、8 种强调色、背景（渐变/纯色/图片 + 暗度/模糊）、字号、圆角、面板宽度、毛玻璃开关 |
| **动画** | 面板滑入缩放、消息上浮入场、列表阶梯滑入、打字光标、按钮反馈；可一键全关 |

### 快捷键

`Enter` 发送 · `Shift+Enter` 换行 · `Esc` 停止/关面板 · `Ctrl+N` 新对话 · `Ctrl+S` 导出

---

## 快速开始

### 1. 安装后端（一次性）

本程序是**客户端**，模型计算依赖 [Ollama](https://ollama.com/download)：

- 到 ollama.com 下载 Windows 版并安装（约 1.8 GB）

### 2. 安装本程序

从 [Releases](../../releases) 下载 **`LocalAI-Studio-Setup.exe`**，双击安装。

> 文件名是英文的，但程序界面和文档都是中文 —— GitHub 对中文文件名的 Release 资源会截断成乱码（实测 `本地AI助手_安装程序.exe` 变成了 `AI._.exe`），所以发布时用了英文名。免安装版是 `LocalAI-Studio-Portable.exe`。

安装时会让你**选择模型存放位置**（建议选空间充足的磁盘，预留 20 GB 以上）。这个选择会自动生效，**你不需要设置任何环境变量，也不需要编辑任何配置文件**。

> 想改路径：程序内「设置 → 后端与联网 → 模型存储目录」。

> 安装包**未做代码签名**，Windows 可能提示「已保护你的电脑」，点「更多信息 → 仍要运行」即可。你也可以自行校验 SHA256。

### 3. 下载模型

打开程序 →「模型市场」→ 选一个 →「下载并部署」。

**在 16 GB 内存 / 纯 CPU 的机器上该选哪个**：

| 模型 | 体积 | 速度 | 评价 |
|---|---|---|---|
| `deepseek-r1:7b` | 4.4 GB | 4–5 tok/s | 质量与速度平衡最佳，**推荐** |
| `qwen3:4b` | 2.3 GB | 8–12 tok/s | 内存更宽裕的甜点选择 |
| `deepseek-r1:1.5b` | 1.0 GB | 14–25 tok/s | 快，但常识和指令遵循会明显出错 |
| `qwen3-embedding:0.6b` | 0.6 GB | — | **用知识库就装这个** |

---

## 技术上的几个取舍

### 零第三方依赖

后端只用 Python 标准库（`http.server` / `urllib` / `winreg`），前端是手写的原生 HTML/CSS/JS，**没有任何框架、没有 CDN**。

这意味着：**完全离线可用**，clone 下来就能跑，不用担心依赖投毒或版本腐烂。

### 为什么用浏览器窗口而不是 Electron

Electron 要额外 200 MB，而 Windows 自带 Chromium 内核。程序在 `127.0.0.1` 起一个本地服务，用 Chrome/Edge 的 `--app` 模式打开**无边框应用窗口** —— 观感与原生程序一致，体积只有 12 MB。

> ⚠️ 实测 **Edge 的 `--app` 窗口在这类环境下约 40 秒后会被浏览器自己收走**（新配置目录触发的后台模式/启动加速，加参数也无效），Chrome 稳定。所以程序优先用 Chrome，并在首次运行时**预热浏览器配置目录**来避免这个问题。可用 `--browser edge` 强制指定。

### 前端外置，可独立更新

`web\` 目录优先于 exe 内嵌的那份加载，且服务端每次都读磁盘、带 `no-cache`。

所以：**改界面、加功能、调样式只要替换 3 个文件（约 90 KB），用户刷新窗口即生效**，不需要重新打包。

### 嵌入模型必须选对

知识库的检索质量**几乎完全取决于嵌入模型**。实测对比：

| 模型 | 正确文档相似度 | 无关文档相似度 | 区分度 | 无关文本之间 |
|---|---|---|---|---|
| `nomic-embed-text` | 0.6766 | **0.7014** | **−0.02** ❌ 排序是错的 | 0.758（几乎不区分） |
| **`qwen3-embedding:0.6b`** | **0.4742** | 0.3585 | **+0.12** ✔ | **0.176** ✔ |

`nomic-embed-text` 是英文向的，**对中文排序会出错**。默认用 `qwen3-embedding:0.6b`。

判定方法（不是自说自话）：往库里塞一条现实中不存在的事实，然后做对照组 ——

- 带知识库 → 模型准确复述了那条虚构事实
- 不带知识库 → 模型自顾自讲别的，**完全不知道**

---

## 已知限制

说清楚，免得期待错位：

- **不支持 PDF / Word / Excel** —— 纯标准库解析不了，请先转成 `.md` / `.txt`
- **本机小模型的能力有硬上限**。7B 能正确回答常识问题，但复杂推理、长文本、深度代码能力仍远不如云端满血模型。**需要准确答案时请联网用 API。**
- 知识库检索用纯 Python 点积，几千个片段是几百毫秒，**上万片段会开始变慢**
- 装 7B 后 16 GB 机器只剩约 1.5 GB 可用内存，跑的时候别开大型程序
- 仅支持 Windows（依赖 `winreg`、`taskkill`、`--app` 模式的浏览器）

---

## 项目结构

```
localai_web.py      本地服务：静态托管 / Ollama 代理 / 联网抓取 / 云端转发 / 生命周期
localai_kb.py       知识库：切块 / 向量化 / 余弦检索 / 换模型自动重建索引
web/
  index.html        界面结构
  style.css         主题变量、过渡动画、背景个性化
  app.js            全部交互逻辑（原生 JS）
ca-bundle.pem       Mozilla 公共根证书（联网抓取用）
build_exe.ps1       一键打包：PyInstaller → NSIS 安装包
installer.nsi       安装包脚本
使用说明.txt         安装包里附带的说明书
自动更新方案.md      自动更新的完整设计（含威胁模型、签名方案、成本估算）
```

## 从源码运行

```powershell
# 需要 Python 3.12（标准库即可，无需 pip install）
python localai_web.py

# 常用参数
python localai_web.py --no-window        # 只起服务，自己用浏览器打开
python localai_web.py --port 8899        # 换端口
python localai_web.py --browser edge     # 强制用 Edge
python localai_web.py --no-backend-start # 不自动拉起 Ollama
```

## 自己打包

需要 `pyinstaller` 和 NSIS，都用 MSYS2 的包管理器装：

```powershell
pacman -S mingw-w64-ucrt-x86_64-pyinstaller mingw-w64-x86_64-nsis
powershell -ExecutionPolicy Bypass -File build_exe.ps1
```

---

## 反馈

发现 bug 请开 [Issue](../../issues)，**附上日志**（程序目录下 `chats\localai.log`），能省很多来回。

欢迎 PR。

## 许可

[MIT](LICENSE)。模型权重与 Ollama 各有其许可证，本项目不分发它们。
