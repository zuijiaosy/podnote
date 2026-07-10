# podnote

小宇宙单集链接 → 云端转写(百炼 fun-asr,含说话人分离) → LLM 生成带归属的结构化笔记。

这是 MVP 第一刀:纯管线,无界面。目标是验证两个核心体验——转写质量和笔记质量。这两个满意了,再做 Tauri 壳。

## 准备(一次性)

```bash
# 1. Node 依赖
npm install

# 2. 凭证
export BAILIAN_API_KEY=...   # 阿里百炼(转写)
export PI_API_KEY=...        # LLM 网关(笔记生成)
```

## 运行

```bash
node src/index.mjs https://www.xiaoyuzhoufm.com/episode/xxxx
```

管线三步:解析单集(拿到公网音频 URL,不下载音频)→ 云端异步转写(一小时音频约 3-5 分钟,逐句带说话人标签)→ LLM 生成笔记(先建立说话人→真名映射,观点和引用都带归属)。

产物:

- `data/<slug>.asr.json` — 转写结果缓存(逐句时间戳 + speaker_id),重跑自动跳过
- `notes/<slug>.md` — 给人读的 Markdown 笔记
- `notes/<slug>.json` — 结构化数据(speakers/tldr/points/quotes/resources/questions,时间戳带秒数,schema 与设计稿 view-model 对齐,将来直接喂给 Tauri 前端)

改 `prompts/note.md` 后重跑,只花 LLM 那一步的钱和时间。

## 可调项(环境变量)

| 变量 | 默认 | 说明 |
|---|---|---|
| `BAILIAN_API_KEY` | 无 | 百炼转写密钥,必填(也接受 `DASHSCOPE_API_KEY`) |
| `BAILIAN_HOST` | 专属网关地址 | 百炼 API host |
| `PI_API_KEY` (或 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) | 无 | 笔记 LLM 密钥,必填 |
| `PI_MODEL` / `PI_PROVIDER` | `grok-4.5` / `codexzh` | 笔记模型与 provider 标识 |
| `PI_BASE_URL` | `https://api.codexzh.com/v1` | LLM 网关地址;置空回落 pi 内置目录(官方 anthropic 等) |
| `PI_API` | `openai-responses` | LLM 协议:`openai-responses` / `openai-completions` / `anthropic-messages` |
| `NOTES_DIR` | `notes` | 笔记输出目录,可直接指到你的笔记库 |

## 已知的脆弱点

- **小宇宙页面解析**(`src/resolve.mjs`):走 og:audio meta + `__NEXT_DATA__` 双路兜底,但没有官方 API,页面改版需要跟着修。挂了的话把页面 HTML 丢给 AI 重新定位字段即可。
- **fun-asr 转写**(`src/asr.mjs`):走 dashscope 标准异步 API(专属 host)。说话人分离官方建议音频 ≤2 小时;节目名等专有名词偶有错听(如"硬地骇客"→"一粒骇客"),LLM 有 shownotes 兜底,后续可加热词表。
- **pi-ai API 版本**:`getModel` 目前在 `@earendil-works/pi-ai/compat` 保留(已标 deprecated)。如果 import 报错,按 pi 仓库 `packages/agent` 的 README 调整 `src/summarize.mjs`。

## 路线图

已完成:Tauri 2 桌面应用(`app/`)——订阅自动化(节目更新自动转写生成笔记 + 系统通知)、
收件箱模型(未读/归档/频道筛选/快捷键 E)、笔记朗读(qwen3-tts-flash 分段合成、渐进播放、
跟随高亮、独立倍速)、浏览器模拟实况自测模式(`?mock=1`)与 pncli 自测子命令(`feed`/`tts`)。

**下一阶段(已定方向,暂缓启动):检索与对话**

1. 笔记与转写内容入库——届时再引入 SQLite + 全文索引;当前数据量下 JSON 文件够用,不提前上
2. 全库检索——按内容找回"某人在某集说过的话",笔记(观点/金句)与逐句转写都可检索
3. AI 对话——给 agent 挂检索工具,实现"跟我听过的所有播客对话"(第二大脑,价值随积累复利)

注意:转写走云端,音频 URL 会提交给阿里百炼——设计稿里"转写在本地进行"的文案在 Tauri 阶段要同步修改。
