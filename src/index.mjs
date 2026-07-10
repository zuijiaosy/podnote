// index.mjs — 主管线: 小宇宙链接 → 笔记
// 用法: node src/index.mjs https://www.xiaoyuzhoufm.com/episode/xxxx
// 转写走云端(音频 URL 直传,不下载音频),结果落盘缓存;改 prompt 重跑只花 LLM 的钱

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveEpisode } from "./resolve.mjs";
import { transcribe, toTimedText } from "./asr.mjs";
import { summarize } from "./summarize.mjs";
import { noteToMarkdown } from "./note.mjs";

const DATA_DIR = "data";
const NOTES_DIR = process.env.NOTES_DIR || "notes";

const url = process.argv[2];
if (!url?.includes("xiaoyuzhoufm.com/episode/")) {
  console.error("用法: node src/index.mjs <小宇宙单集链接>");
  process.exit(1);
}

function slugify(title) {
  return title
    .replace(/[^\p{Script=Han}\w]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(NOTES_DIR, { recursive: true });

console.log("== 1/3 解析单集 ==");
const meta = await resolveEpisode(url);
console.log(`   ${meta.podcast} — ${meta.title}`);
const slug = slugify(meta.title);

console.log("== 2/3 云端转写(含说话人分离) ==");
const asrPath = path.join(DATA_DIR, slug + ".asr.json");
let asrResult;
if (existsSync(asrPath)) {
  console.log(`[skip] 转写结果已存在: ${asrPath}`);
  asrResult = JSON.parse(readFileSync(asrPath, "utf8"));
} else {
  asrResult = await transcribe(meta.audioUrl);
  writeFileSync(asrPath, JSON.stringify(asrResult));
  console.log(`[asr] 转写结果已缓存: ${asrPath}`);
}

console.log("== 3/3 生成笔记 ==\n");
let note;
try {
  note = await summarize({ meta, timedText: toTimedText(asrResult) });
} catch (e) {
  if (e.raw) {
    const rawPath = path.join(NOTES_DIR, slug + ".raw.txt");
    writeFileSync(rawPath, e.raw);
    console.error(`\n${e.message}\n原始输出已存到 ${rawPath},修好 prompt 后重跑即可(转写有缓存,只花 LLM 的钱)`);
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
