# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

Podnote:本地单机的播客笔记仪器(Tauri,macOS + Windows beta)。小宇宙单集链接 → 云端转写(阿里百炼 fun-asr,含说话人分离)→ LLM 生成带归属的结构化笔记。产品哲学:自带 API 钥匙(BYO-key)、数据全在本机、每次花钱的动作由用户显式触发且成本透明、笔记是收听的伴生品(时间戳回跳重听)而非替代品。

代码在 `app/`:React 前端 + Rust 后端的 Tauri 2 桌面应用。

## 常用命令

```bash
# 开发(app/ 目录下)
cd app && npm run tauri dev          # 起完整桌面应用
cd app && npx vite                   # 只起前端;浏览器加 ?mock=1 = 内存假后端全流程自测,不带参数 = DemoApp 设计评审模式

# 检查与测试
cd app/src-tauri && cargo check
cd app/src-tauri && cargo test                    # 含 prompt 模板、纠错替换等单测
cd app/src-tauri && cargo test <test_name>        # 单跑一个测试
cd app && npm run build                            # 前端构建(vite),验证 JSX

# 打包
cd app && npm run tauri build
# 产物: app/src-tauri/target/release/bundle/(macOS 出 dmg/app,Windows 出 nsis/msi)
```

## 架构大图

### 前端三运行模式(app/src/App.jsx)
- **Tauri 内** → `LiveApp`,走 `lib/backend.js` 的 `realApi`(invoke/listen)
- **浏览器 + `?mock=1`** → `LiveApp`,走 `lib/mock.js` 的 `mockApi`(内存假后端 + 事件总线,不花钱不碰真数据)
- **纯浏览器** → `DemoApp`(fixtures 静态数据,设计评审用)

`mockApi` 与 `realApi` 形状一一对应:**每加一个 Tauri 命令,必须同步 `backend.js` 和 `mock.js`**;屏组件被 `LiveApp` 和 `DemoApp` 共用,改屏组件 props 时要同步 `DemoApp.jsx` 的调用处。

### Rust 后端(app/src-tauri/src/)
- `commands.rs` — 全部 Tauri 命令 + 管线运行器 + 事件发射;新命令要在 `lib.rs` 的 `generate_handler!` 注册
- `pipeline/` — resolve(解析小宇宙页)、asr(百炼转写)、vocab(热词表)、summarize(笔记生成)、note(JSON 解析)、llm(三协议流式客户端:OpenAI Responses / Chat Completions / Anthropic Messages)、tts(朗读合成)、correct + agent + tavily(纠错与查证)、glossary(频道词表)
- `library.rs` / `subscriptions.rs` — 单集库与订阅存储(app 数据目录下 JSON 文件)

管线阶段:`RESOLVE → TRANSCRIBE → SUMMARIZE → READY`,进度经 `pipeline-progress` 事件推给前端(AddFlow 五灯与磁带架同源消费)。事件与阶段 key 保持英文,UI 文案一律中文(映射在 `backend.js` 的 `STAGE_ZH`)。

### 三层专有名词纠错(本项目的差异化)
1. shownotes 提取实体 → 频道词表(glossary,人工纠正沉淀)
2. 实体喂给 fun-asr 热词表(vocab,用后即删)
3. 事后查证:划词右键「核实」/ 块级核查 agent(Tavily 搜索),`apply_correction` 全文替换笔记+字幕并沉淀词表

### Prompt 管理
`prompts/*.md` 是唯一真源,经 `include_str!` **编译期内嵌**——改 prompt 必须重新编译 Rust 才生效。语言规则:无论节目什么语言,笔记一律中文;专有名词保留原文不翻译。`entities.md` 是例外(热词保持原文写法,别给它加翻译规则)。

### 密钥与设置
- 密钥存 app 数据目录 `keys.json` 明文(取舍:无签名证书时钥匙串每次打包都重复弹窗),启动读一次进内存,运行期零钥匙串访问
- `tauri.conf.json` 的 `identifier`(com.podnote.app)**已冻结**:它决定应用数据目录,改动 = 已有用户数据"消失";除非同时提供已验证的迁移,否则不得更改
- 设置存 `settings.json`;`llm_base_url`/`llm_model` **默认为空**是有意的安全决定(key 随请求发往网关,默认指向任何第三方等于替用户做安全决定),不要给它们加默认值
- 连接自检命令(`test_asr_key`/`test_llm`/`test_tavily`)发最小真实请求验证配置

### 笔记数据 schema
`{speakers, tldr, points[{ts,who,h,body}], quotes[{ts,who,text}], resources[{name,note}], questions[]}` — 时间戳必须来自转写稿,说话人归属禁止靠猜(宁写"主播")。

## 设计系统(app/src/components/)

`core.jsx`(Button/Input/Select/Segmented/Lever/Checkbox/FieldRow) + `instrument.jsx`(StatusLabel/IndicatorLight/Timestamp/EpisodeItem/Waveform),移植自 `design/Podnote-standalone.html`(设计真源)。仪器风硬规则:
- 不用系统原生控件(下拉是自绘的,面板材质 = panel 底 + line-soft 描边,无阴影)
- 中文最低 12px(`--text-sm`),中文禁入等宽字体;机器内容(时间戳/key/URL)用 mono
- 选中态语言 = `fill-active` 底 + `ink` 描边;状态灯四态:灰待命/炭呼吸运转/绿常亮完成/橙常亮需要人
- 动效用 tokens.css 的 `pn-enter`/`pn-pop`/`pn-flash` + `--dur`/`--ease`,120ms 急停风格
