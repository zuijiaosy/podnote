// index.mjs — 主管线: 小宇宙链接 → 笔记
// 用法: node src/index.mjs https://www.xiaoyuzhoufm.com/episode/xxxx
// 每步产物落盘,重跑自动跳过已完成的步骤(改 prompt 后重跑只花 LLM 那一步的时间)

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveEpisode } from "./resolve.mjs";
import {
  downloadAudio,
  toWav,
  transcribe,
  slugify,
  audioPathFor,
} from "./transcribe.mjs";
import { summarize } from "./summarize.mjs";

const DATA_DIR = "data";
const NOTES_DIR = process.env.NOTES_DIR || "notes";

const url = process.argv[2];
if (!url?.includes("xiaoyuzhoufm.com/episode/")) {
  console.error("用法: node src/index.mjs <小宇宙单集链接>");
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(NOTES_DIR, { recursive: true });

console.log("== 1/4 解析单集 ==");
const meta = await resolveEpisode(url);
console.log(`   ${meta.podcast} — ${meta.title}`);

console.log("== 2/4 下载音频 ==");
const audioPath = await downloadAudio(
  meta.audioUrl,
  audioPathFor(DATA_DIR, meta.title, meta.audioUrl)
);

console.log("== 3/4 转写 ==");
const wavPath = toWav(audioPath);
const srt = transcribe(wavPath);

console.log("== 4/4 生成笔记 ==\n");
const note = await summarize({ meta, srt });

const notePath = path.join(NOTES_DIR, slugify(meta.title) + ".md");
writeFileSync(
  notePath,
  note + `\n\n---\n原始链接: ${meta.url}\n生成时间: ${new Date().toISOString()}\n`
);
console.log(`\n✅ 笔记已写入: ${notePath}`);
