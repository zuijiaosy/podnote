// mock — 浏览器模拟实况模式(?mock=1):内存假后端,不花钱不碰真数据,
// 供 LiveApp 全流程交互自测(添加五灯 / 收件箱归档 / 订阅 / 朗读渐进播放)。
// 与 backend.js 的 api 形状一一对应;事件走内存总线,音频用生成的静音 WAV。
import ep125 from "../fixtures/ep125.json";
import ep143 from "../fixtures/ep143.json";

// ===== 事件总线(模拟 tauri listen) =====
const listeners = {};
function on(event, cb) {
  (listeners[event] ??= new Set()).add(cb);
  return Promise.resolve(() => listeners[event]?.delete(cb));
}
function emit(event, payload) {
  listeners[event]?.forEach((cb) => cb(payload));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 静音 WAV(24kHz 单声道 16bit),朗读播放用 =====
function silentWavUrl(seconds) {
  const sr = 24000;
  const n = Math.round(sr * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// ===== 内存状态 =====
let settings = {
  asrHost: "https://mock.example", llmBaseUrl: "https://mock.example/v1",
  llmApi: "openai-responses",
  llmModel: "grok-4.5", notesDir: null, subAuto: true, ttsVoice: "Cherry", ttsRate: 1.5,
  asrKeySet: true, llmKeySet: true,
};
const notes = {
  m1: ep125,
  m2: ep143,
  m4: { ...ep125, meta: { ...ep125.meta, title: "EP124 为什么 Agent 时代,CLI 反而成了最优解" } },
};
let records = [
  { id: "m1", url: ep125.meta.url, show: ep125.meta.podcast, title: ep125.meta.title, date: "07-09", durationSec: ep125.meta.durationSec, status: "ready", readAt: null },
  { id: "m2", url: ep143.meta.url, show: ep143.meta.podcast, title: ep143.meta.title, date: "07-06", durationSec: ep143.meta.durationSec, status: "ready", readAt: null },
  { id: "m3", url: "https://mock/e/m3", show: "硅谷101", title: "芯片战争下半场:先进封装", date: "06-28", durationSec: 3922, status: "error", errStage: "RESOLVE", errMessage: "没解析出音频地址(模拟错误)", readAt: null },
  { id: "m4", url: "https://mock/e/m4", show: "硬地骇客", title: "EP124 为什么 Agent 时代,CLI 反而成了最优解", date: "06-20", durationSec: 4100, status: "ready", readAt: 1751500000 },
];
let subs = [
  { pid: "mock-pid-1", title: "硬地骇客", lastPub: "2026-06-09T14:02:10.100Z" },
  { pid: "mock-pid-2", title: "张小珺Jùn｜商业访谈录", lastPub: "2026-07-06T10:00:00.000Z" },
];
const ttsStore = {}; // id -> {complete, segments:[{seq,key,path}]}
let seq = 100; // 从 100 起,避开预置的 mock-pid-1/2 造成 key 重复

function pipeEmit(id, stage, status, detail = "") {
  emit("pipeline-progress", { id, stage, status, detail });
}

/** 模拟完整管线:五灯按真实节奏走,最后挂上 ep125 的笔记 */
async function simulatePipeline(id) {
  const upd = (patch) => { records = records.map((r) => (r.id === id ? { ...r, ...patch } : r)); };
  upd({ status: "resolving" });
  pipeEmit(id, "RESOLVE", "processing");
  await sleep(700);
  upd({ show: "模拟节目", title: "模拟单集:管线全流程演练", date: "07-10", durationSec: 4432 });
  pipeEmit(id, "RESOLVE", "ready", "模拟单集");
  upd({ status: "transcribing" });
  for (let s = 0; s <= 2; s++) {
    pipeEmit(id, "TRANSCRIBE", "processing", `00:0${s * 2}`);
    await sleep(600);
  }
  pipeEmit(id, "TRANSCRIBE", "ready", "00:06");
  upd({ status: "summarizing" });
  pipeEmit(id, "SUMMARIZE", "processing", "1200 字");
  await sleep(900);
  pipeEmit(id, "SUMMARIZE", "ready");
  notes[id] = { ...ep125, meta: { ...ep125.meta, title: "模拟单集:管线全流程演练" } };
  upd({ status: "ready" });
  pipeEmit(id, "READY", "ready");
}

export const mockApi = {
  getLibrary: async () => records,
  getNote: async (id) => notes[id] ?? null,
  getNoteMarkdown: async (id) => (notes[id] ? `# ${notes[id].meta.title}\n\n${notes[id].note.tldr}` : null),
  getTranscript: async (id) =>
    notes[id]?.note?.points?.map((p, i) => ({ t: i * 30, end: i * 30 + 28, spk: `S${(i % 3) + 1}`, text: p.body })) ?? null,
  addEpisode: async (url) => {
    if (!/xiaoyuzhoufm\.com\/episode\//.test(url) && !/^https:\/\/mock/.test(url)) {
      throw "这不是有效的小宇宙单集链接";
    }
    const id = `mock-${++seq}`;
    const rec = { id, url, show: "", title: url, date: "", durationSec: 0, status: "queued", readAt: null };
    records = [rec, ...records];
    simulatePipeline(id);
    return rec;
  },
  retry: async (id) => { simulatePipeline(id); },
  regenerate: async (id) => { delete ttsStore[id]; simulatePipeline(id); },
  regenerateTranscript: async (id) => { delete ttsStore[id]; simulatePipeline(id); },
  deleteEpisode: async (id) => { records = records.filter((r) => r.id !== id); },
  setRead: async (id, read) => {
    records = records.map((r) => (r.id === id ? { ...r, readAt: read ? 1752000000 : null } : r));
  },
  revealNote: async () => {},
  getAudioPath: async () => null,
  downloadAudio: async (id) => {
    for (let pct = 20; pct <= 100; pct += 20) {
      emit("audio-progress", { id, pct });
      await sleep(150);
    }
    return silentWavUrl(30); // 30 秒静音充当"播客原声"
  },
  getSettings: async () => settings,
  setSettings: async (s) => { settings = { ...settings, ...s }; },
  setKeys: async () => {},
  getSubscriptions: async () => subs,
  addSubscription: async (url) => {
    if (!/xiaoyuzhoufm\.com\/(podcast|episode)\//.test(url)) throw "请粘贴小宇宙节目页或单集页链接";
    const sub = { pid: `mock-pid-${++seq}`, title: `模拟订阅 ${seq}`, lastPub: "2026-07-10T00:00:00.000Z" };
    subs = [...subs, sub];
    emit("subscriptions-changed", null);
    return sub;
  },
  removeSubscription: async (pid) => {
    subs = subs.filter((s) => s.pid !== pid);
    emit("subscriptions-changed", null);
  },
  checkSubscriptions: async () => {
    await sleep(800);
    const id = `mock-sub-${++seq}`;
    records = [
      { id, url: `https://mock/e/${id}`, show: "硬地骇客", title: "EP128 模拟新单集(订阅自动发现)", date: "07-10", durationSec: 3600, status: "queued", readAt: null },
      ...records,
    ];
    emit("subscriptions-changed", null);
    simulatePipeline(id);
    return 1;
  },
  getTts: async (id) => ttsStore[id] ?? null,
  generateTts: async (id) => {
    const note = notes[id]?.note;
    if (!note) throw "笔记还没生成";
    const keys = [
      ...(note.tldr ? ["tldr"] : []),
      ...(note.points ?? []).map((_, i) => `point-${i}`),
      ...(note.quotes ?? []).map((_, i) => `quote-${i}`),
    ];
    const total = keys.length;
    ttsStore[id] = { complete: false, segments: keys.map((key, i) => ({ seq: i, key, path: null })) };
    (async () => {
      for (let i = 0; i < total; i++) {
        emit("tts-progress", { id, status: "processing", done: i, total });
        await sleep(700); // 模拟每段合成耗时
        const path = silentWavUrl(2.5);
        ttsStore[id].segments[i] = { seq: i, key: keys[i], path };
        emit("tts-progress", { id, status: "segment", seq: i, key: keys[i], total, path });
      }
      ttsStore[id].complete = true;
      emit("tts-progress", { id, status: "ready", done: total, total });
    })();
  },
  onProgress: (cb) => on("pipeline-progress", cb),
  onAudioProgress: (cb) => on("audio-progress", cb),
  onSubscriptionsChanged: (cb) => on("subscriptions-changed", cb),
  onTtsProgress: (cb) => on("tts-progress", cb),
};
