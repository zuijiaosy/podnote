# podnote

小宇宙单集链接 → 本地 whisper.cpp 转写 → Pi agent 调 LLM 生成结构化 Markdown 笔记。

这是 MVP 第一刀:纯管线,无界面。目标是验证两个核心体验——转写质量和笔记质量。这两个满意了,再做 Tauri 壳。

## 准备(一次性)

```bash
# 1. 系统依赖
brew install ffmpeg whisper-cpp

# 2. whisper 模型(先用 medium 试速度,满意再换 large-v3 提质量)
mkdir -p models
curl -L -o models/ggml-medium.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
# large-v3(约 3GB,中文效果更好):
# curl -L -o models/ggml-large-v3.bin \
#   https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin

# 3. Node 依赖
npm install

# 4. LLM 凭证
export ANTHROPIC_API_KEY=sk-ant-...
```

## 运行

```bash
# 用 medium 模型时:
WHISPER_MODEL=models/ggml-medium.bin \
node src/index.mjs https://www.xiaoyuzhoufm.com/episode/69e669001e94ae6921be04dc
```

产物:

- `data/` — 音频、wav、srt 转写稿(带时间戳)
- `notes/` — 每集两个文件:`.md` 给人读,`.json` 结构化数据(tldr/points/quotes/resources/questions,时间戳带秒数,schema 与设计稿 view-model 对齐,将来直接喂给 Tauri 前端)

每一步产物落盘、重跑自动跳过,所以调 prompt 时重跑只花 LLM 那一步的钱和时间。

## 可调项(环境变量)

| 变量 | 默认 | 说明 |
|---|---|---|
| `WHISPER_MODEL` | `models/ggml-large-v3.bin` | whisper 模型路径 |
| `WHISPER_BIN` | `whisper-cli` | whisper.cpp 可执行文件 |
| `PI_PROVIDER` / `PI_MODEL` | `anthropic` / `claude-sonnet-4-6` | 走 pi-ai 的模型选择 |
| `PI_BASE_URL` (或 `ANTHROPIC_BASE_URL`) | 官方地址 | 自定义 API 网关地址,key 仍走 `ANTHROPIC_API_KEY` |
| `NOTES_DIR` | `notes` | 笔记输出目录,可直接指到你的笔记库 |

## 已知的脆弱点

- **小宇宙页面解析**(`src/resolve.mjs`):走 og:audio meta + `__NEXT_DATA__` 双路兜底,但没有官方 API,页面改版需要跟着修。挂了的话把页面 HTML 丢给 AI 重新定位字段即可。
- **pi-ai API 版本**:pi 的 API 从全局函数迁移到了 provider factory,`getModel` 目前在 `@earendil-works/pi-ai/compat` 保留。如果 import 报错,按 pi 仓库 `packages/agent` 的 README 调整 `src/summarize.mjs` 顶部几行。

## 下一步路线

1. 拿 3-5 集真实节目跑,迭代 `prompts/note.md` 直到笔记让自己满意
2. 把真实笔记喂给 Claude Design 出界面稿
3. Tauri 2 壳 + 本目录改造成 sidecar(常驻、订阅轮询、通知)
4. 远期:笔记入库 + 给 agent 挂 search_notes 工具,实现"跟我听过的所有播客对话"
