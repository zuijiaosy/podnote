// summarize.mjs — 转写稿 → 结构化笔记 JSON (schema 见 note.mjs)
// 走 Pi 底座 (@earendil-works/pi-agent-core + pi-ai)。
// 注意: pi-ai 的 API 近期从全局函数迁移到了 createModels()/provider factory,
// 旧的 getModel 等在 "@earendil-works/pi-ai/compat" 保留。如果下面的 import
// 报错,以 https://github.com/earendil-works/pi 的 packages/agent README 为准微调。
//
// 环境变量: ANTHROPIC_API_KEY (或按 pi 文档配置你的自建网关/自定义 provider)

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai/compat";
import { parseNote } from "./note.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 默认走自定义网关(OpenAI Responses 协议)。想换模型/网关改这四个环境变量;
// PI_BASE_URL 置空则回落到 pi 内置目录(如官方 anthropic)。
const MODEL_PROVIDER = process.env.PI_PROVIDER || "codexzh";
const MODEL_ID = process.env.PI_MODEL || "grok-4.5";
const BASE_URL = process.env.PI_BASE_URL ?? "https://api.codexzh.com/v1";
const API_PROTOCOL = process.env.PI_API || "openai-responses";
const API_KEY =
  process.env.PI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY;

function buildModel() {
  if (!BASE_URL) return getModel(MODEL_PROVIDER, MODEL_ID);
  // 自定义网关:手工构造 Model 描述对象,协议由 PI_API 指定
  return {
    id: MODEL_ID,
    name: MODEL_ID,
    api: API_PROTOCOL,
    provider: MODEL_PROVIDER,
    baseUrl: BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
  };
}

const promptTemplate = readFileSync(
  path.join(__dirname, "..", "prompts", "note.md"),
  "utf8"
);

// srt 太啰嗦,压缩成 [mm:ss] 文本行,省 token
export function srtToTimedText(srt) {
  const lines = [];
  const blocks = srt.split(/\n\n+/);
  for (const block of blocks) {
    const m = block.match(
      /(\d{2}):(\d{2}):(\d{2}),\d{3}\s*-->[\s\S]*?\n([\s\S]+)/
    );
    if (!m) continue;
    const [, h, mm, ss, text] = m;
    const t =
      h === "00" ? `${mm}:${ss}` : `${Number(h) * 60 + Number(mm)}:${ss}`;
    lines.push(`[${t}] ${text.replace(/\n/g, " ").trim()}`);
  }
  return lines.join("\n");
}

export async function summarize({ meta, srt }) {
  if (!API_KEY) {
    throw new Error(
      "缺少 API key:请设置 PI_API_KEY(或 OPENAI_API_KEY / ANTHROPIC_API_KEY)"
    );
  }
  const timedText = srtToTimedText(srt);
  const prompt = promptTemplate
    .replaceAll("{{title}}", meta.title)
    .replaceAll("{{podcast}}", meta.podcast)
    .replaceAll("{{shownotes}}", meta.shownotes || "(无)")
    .replaceAll("{{transcript}}", timedText);

  const agent = new Agent({
    initialState: {
      systemPrompt:
        "你是一个中文播客笔记助手。只输出一个合法的 JSON 对象,不要 Markdown 代码块,不要任何前言后语。",
      model: buildModel(),
    },
    getApiKey: () => API_KEY,
  });

  let out = "";
  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      out += event.assistantMessageEvent.delta;
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await agent.prompt(prompt);
  process.stdout.write("\n");
  return parseNote(out); // 解析失败会抛错,error.raw 带着原始输出
}
