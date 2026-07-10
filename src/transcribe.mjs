// transcribe.mjs — 下载音频 → ffmpeg 转 16k wav → whisper.cpp 转写
// 依赖: brew install ffmpeg whisper-cpp
// 模型: 下载 ggml-large-v3.bin (或先用 medium 试速度) 放到 models/ 目录
//   curl -L -o models/ggml-large-v3.bin \
//     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin

import { execFileSync, execSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const WHISPER_BIN = process.env.WHISPER_BIN || "whisper-cli"; // brew 版叫 whisper-cli
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || "models/ggml-large-v3.bin";

export async function downloadAudio(audioUrl, destPath) {
  if (existsSync(destPath)) {
    console.log(`[skip] 音频已存在: ${destPath}`);
    return destPath;
  }
  console.log(`[download] ${audioUrl}`);
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`音频下载失败: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  return destPath;
}

export function toWav(audioPath) {
  const wavPath = audioPath.replace(/\.[^.]+$/, ".16k.wav");
  if (existsSync(wavPath)) {
    console.log(`[skip] wav 已存在: ${wavPath}`);
    return wavPath;
  }
  console.log(`[ffmpeg] → ${wavPath}`);
  execSync(
    `ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
    { stdio: "inherit" }
  );
  return wavPath;
}

export function transcribe(wavPath) {
  const outBase = wavPath.replace(/\.wav$/, "");
  const srtPath = `${outBase}.srt`;
  if (existsSync(srtPath)) {
    console.log(`[skip] 转写稿已存在: ${srtPath}`);
    return readFileSync(srtPath, "utf8");
  }
  if (!existsSync(WHISPER_MODEL)) {
    throw new Error(
      `找不到 whisper 模型: ${WHISPER_MODEL}\n先下载模型,见本文件头部注释`
    );
  }
  console.log(`[whisper] 转写中(一小时音频在 M 系芯片上约需几分钟)...`);
  execFileSync(
    WHISPER_BIN,
    [
      "-m", WHISPER_MODEL,
      "-l", "zh",
      "-f", wavPath,
      "-osrt",             // 输出 srt,自带时间戳,喂给 LLM 最方便
      "-of", outBase,
      "-t", String(Math.max(4, (process.env.THREADS ?? 8))),
    ],
    { stdio: "inherit" }
  );
  return readFileSync(srtPath, "utf8");
}

export function slugify(title) {
  return title
    .replace(/[^\p{Script=Han}\w]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function audioPathFor(dataDir, title, audioUrl) {
  const ext = path.extname(new URL(audioUrl).pathname) || ".m4a";
  return path.join(dataDir, slugify(title) + ext);
}
