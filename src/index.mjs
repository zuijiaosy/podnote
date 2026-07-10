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
import { noteToMarkdown } from "./note.mjs";

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
const slug = slugify(meta.title);
let note;
try {
  note = await summarize({ meta, srt });
} catch (e) {
  if (e.raw) {
    const rawPath = path.join(NOTES_DIR, slug + ".raw.txt");
    writeFileSync(rawPath, e.raw);
    console.error(`\n${e.message}\n原始输出已存到 ${rawPath},修好 prompt 后重跑即可(转写稿有缓存,只花 LLM 的钱)`);
  }
  throw e;
}

// 双产物:.json 给将来的 App(schema 与设计稿 view-model 对齐),.md 给现在的人读
const jsonPath = path.join(NOTES_DIR, slug + ".json");
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      meta: {
        url: meta.url,
        podcast: meta.podcast,
        title: meta.title,
        durationSec: meta.duration,
        generatedAt: new Date().toISOString(),
      },
      note,
    },
    null,
    2
  )
);
const mdPath = path.join(NOTES_DIR, slug + ".md");
writeFileSync(mdPath, noteToMarkdown(meta, note));
console.log(`\n✅ 笔记已写入: ${mdPath}\n   数据文件: ${jsonPath}`);
