// backend — Tauri 命令与事件的前端桥;浏览器环境(设计评审模式)时 inTauri=false
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  getLibrary: () => invoke("get_library"),
  getNote: (id) => invoke("get_note", { id }),
  getNoteMarkdown: (id) => invoke("get_note_markdown", { id }),
  addEpisode: (url) => invoke("add_episode", { url }),
  retry: (id) => invoke("retry_episode", { id }),
  regenerate: (id) => invoke("regenerate_note", { id }),
  deleteEpisode: (id) => invoke("delete_episode", { id }),
  revealNote: (id) => invoke("reveal_note", { id }),
  getSettings: () => invoke("get_settings"),
  setSettings: (settings) => invoke("set_settings", { settings }),
  setKeys: (asrKey, llmKey) => invoke("set_keys", { asrKey: asrKey ?? null, llmKey: llmKey ?? null }),
  /** 订阅管线进度;返回取消函数 */
  onProgress: (cb) => listen("pipeline-progress", (e) => cb(e.payload)),
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
    queued: "QUEUED",
    resolving: "RESOLVING",
    transcribing: "TRANSCRIBING",
    summarizing: "SUMMARIZING",
    ready: "READY",
    error: "ERROR",
  }[status] ?? status.toUpperCase();
}
