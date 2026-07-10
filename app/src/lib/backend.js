// backend — Tauri 命令与事件的前端桥;浏览器环境(设计评审模式)时 inTauri=false
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  getLibrary: () => invoke("get_library"),
  getNote: (id) => invoke("get_note", { id }),
  getNoteMarkdown: (id) => invoke("get_note_markdown", { id }),
  getTranscript: (id) => invoke("get_transcript", { id }),
  addEpisode: (url) => invoke("add_episode", { url }),
  retry: (id) => invoke("retry_episode", { id }),
  regenerate: (id) => invoke("regenerate_note", { id }),
  deleteEpisode: (id) => invoke("delete_episode", { id }),
  revealNote: (id) => invoke("reveal_note", { id }),
  getAudioPath: (id) => invoke("get_audio_path", { id }),
  downloadAudio: (id) => invoke("download_audio", { id }),
  getSettings: () => invoke("get_settings"),
  setSettings: (settings) => invoke("set_settings", { settings }),
  setKeys: (asrKey, llmKey) => invoke("set_keys", { asrKey: asrKey ?? null, llmKey: llmKey ?? null }),
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
};

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
