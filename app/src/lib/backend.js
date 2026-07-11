// backend — Tauri 命令与事件的前端桥
// 浏览器环境:默认设计评审模式(DemoApp);带 ?mock=1 时为模拟实况模式(LiveApp + 内存假后端,自测用)
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mockApi } from "./mock.js";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const mockMode =
  !inTauri && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

/** 本地文件路径 → <audio> 可用的 URL(Tauri 走 asset 协议;mock 模式下路径本身就是 blob URL) */
export async function toMediaUrl(path) {
  if (!inTauri) return path;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

/** 外开链接(纠正证据等):Tauri 走 opener 插件,浏览器新标签页 */
export async function openExternal(url) {
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

const realApi = {
  getLibrary: () => invoke("get_library"),
  getNote: (id) => invoke("get_note", { id }),
  getNoteMarkdown: (id) => invoke("get_note_markdown", { id }),
  getTranscript: (id) => invoke("get_transcript", { id }),
  addEpisode: (url) => invoke("add_episode", { url }),
  retry: (id) => invoke("retry_episode", { id }),
  regenerate: (id) => invoke("regenerate_note", { id }),
  /** 重新转写:删缓存全量重跑,级联重新生成笔记 */
  regenerateTranscript: (id) => invoke("regenerate_transcript", { id }),
  deleteEpisode: (id) => invoke("delete_episode", { id }),
  /** 归档/取消归档(消费状态) */
  setRead: (id, read) => invoke("set_read", { id, read }),
  revealNote: (id) => invoke("reveal_note", { id }),
  getAudioPath: (id) => invoke("get_audio_path", { id }),
  downloadAudio: (id) => invoke("download_audio", { id }),
  /** 波形峰值缓存:首次解码后持久化,重启秒显真波形 */
  getPeaks: (id) => invoke("get_peaks", { id }),
  savePeaks: (id, peaks) => invoke("save_peaks", { id, peaks }),
  /** 已合成的朗读音频 {path, voice, segments};没有则 null */
  getTts: (id) => invoke("get_tts", { id }),
  generateTts: (id) => invoke("generate_tts", { id }),
  /** 划词纠正:查证可疑词,返回 {corrected, confidence, evidenceUrl, note} */
  researchTerm: (id, term, context) => invoke("research_term", { id, term, context }),
  /** 应用纠正:笔记+字幕全文替换并沉淀频道词表;返回笔记替换处数 */
  applyCorrection: (id, original, corrected, evidenceUrl, confidence) =>
    invoke("apply_correction", { id, original, corrected, evidenceUrl: evidenceUrl ?? null, confidence }),
  /** 单集纠正记录(下划线标记数据源) */
  getCorrections: (id) => invoke("get_corrections", { id }),
  getSettings: () => invoke("get_settings"),
  setSettings: (settings) => invoke("set_settings", { settings }),
  setKeys: (asrKey, llmKey, tavilyKey) =>
    invoke("set_keys", { asrKey: asrKey ?? null, llmKey: llmKey ?? null, tavilyKey: tavilyKey ?? null }),
  getSubscriptions: () => invoke("get_subscriptions"),
  addSubscription: (url) => invoke("add_subscription", { url }),
  removeSubscription: (pid) => invoke("remove_subscription", { pid }),
  /** 手动检查订阅更新;返回新增单集数 */
  checkSubscriptions: () => invoke("check_subscriptions"),
  /** 订阅管线进度;返回取消函数 */
  onProgress: (cb) => listen("pipeline-progress", (e) => cb(e.payload)),
  /** 订阅音频下载进度 {id, pct} */
  onAudioProgress: (cb) => listen("audio-progress", (e) => cb(e.payload)),
  /** 订阅表或自动入库有变化 */
  onSubscriptionsChanged: (cb) => listen("subscriptions-changed", () => cb()),
  /** 朗读合成进度 {id, status, done, total, detail} */
  onTtsProgress: (cb) => listen("tts-progress", (e) => cb(e.payload)),
};

export const api = mockMode ? mockApi : realApi;

/** 后端状态 → 组件四态 */
export function uiStatus(status) {
  if (status === "ready") return "ready";
  if (status === "error") return "error";
  if (status === "queued") return "off";
  return "processing"; // resolving | transcribing | summarizing
}

export function uiStatusLabel(status) {
  return {
    queued: "排队中",
    resolving: "解析中",
    transcribing: "转写中",
    summarizing: "生成笔记",
    ready: "就绪",
    error: "出错",
  }[status] ?? status;
}

/** 管线阶段 key → 中文显示名(事件协议 key 保持英文) */
export const STAGE_ZH = {
  KEY: "密钥",
  RESOLVE: "解析",
  TRANSCRIBE: "转写",
  SUMMARIZE: "生成笔记",
  READY: "完成",
};
