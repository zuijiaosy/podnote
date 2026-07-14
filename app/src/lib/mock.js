// mock — 浏览器模拟实况模式(?mock=1):内存假后端,不花钱不碰真数据,
// 供 LiveApp 全流程交互自测(添加五灯 / 收件箱归档 / 订阅 / 朗读渐进播放)。
// 与 backend.js 的 api 形状一一对应;事件走内存总线,音频用生成的静音 WAV。
import ep125 from "../fixtures/ep125.json";
import ep143 from "../fixtures/ep143.json";
import researchEvents from "../fixtures/research-events.json";
import { replayEvents } from "./research.js";

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

// ===== WAV 生成(24kHz 单声道 16bit):静音款朗读用;带波形款充当"播客原声",
// 让 extractPeaks 真解码出起伏峰值,自测波形生长动效 =====
function wavUrl(seconds, sample = null) {
  const sr = 24000;
  const n = Math.round(sr * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  if (sample) {
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(sample(i / sr) * 32767), true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
const silentWavUrl = (seconds) => wavUrl(seconds);
/** 低音量语音状拟真波形:多个包络叠加,峰值起伏明显 */
const speechWavUrl = (seconds) =>
  wavUrl(seconds, (t) =>
    0.12 * Math.sin(2 * Math.PI * 180 * t)
      * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.7) * Math.sin(t * 0.43 + 1))));

// ===== 内存状态 =====
let settings = {
  asrHost: "https://mock.example", llmBaseUrl: "https://mock.example/v1",
  llmApi: "openai-responses",
  llmModel: "grok-4.5", notesDir: null, subAuto: true, ttsVoice: "Cherry", ttsRate: 1.5,
  asrKeySet: true, llmKeySet: true, tavilyKeySet: true,
  asrKeyHint: "k3f8", llmKeyHint: "9zq2", tavilyKeyHint: "x7m4",
};
const notes = {
  m1: ep125,
  m2: ep143,
  m4: { ...ep125, meta: { ...ep125.meta, title: "EP124 为什么 Agent 时代,CLI 反而成了最优解" } },
  m5: { ...ep143, meta: { ...ep143.meta, title: "Sam Altman on the Future of Compute" } },
  m6: ep125, m7: ep125, m8: ep125,
};
let records = [
  { id: "m1", url: ep125.meta.url, show: ep125.meta.podcast, title: ep125.meta.title, date: "07-09", durationSec: ep125.meta.durationSec, status: "ready", readAt: null },
  { id: "m2", url: ep143.meta.url, show: ep143.meta.podcast, title: ep143.meta.title, date: "07-06", durationSec: ep143.meta.durationSec, status: "ready", readAt: null },
  { id: "m3", url: "https://mock/e/m3", show: "硅谷101", title: "芯片战争下半场:先进封装", date: "06-28", durationSec: 3922, status: "error", errStage: "RESOLVE", errMessage: "没解析出音频地址(模拟错误)", readAt: null },
  { id: "m4", url: "https://mock/e/m4", show: "硬地骇客", title: "EP124 为什么 Agent 时代,CLI 反而成了最优解", date: "06-20", durationSec: 4100, status: "ready", readAt: 1751500000 },
  // m5:长英文频道名 — 自测频道条单行截断;m6-m8:凑满 7 个频道自测「+N」折叠(归档态,不占未读收件箱)
  { id: "m5", url: "https://mock/e/m5", show: "No Priors: Artificial Intelligence | Technology | Startups", title: "Sam Altman on the Future of Compute", date: "07-11", durationSec: 2860, status: "ready", readAt: null },
  { id: "m6", url: "https://mock/e/m6", show: "Lex Fridman Podcast", title: "Demis Hassabis: AlphaFold and AGI", date: "06-15", durationSec: 7200, status: "ready", readAt: 1751000000 },
  { id: "m7", url: "https://mock/e/m7", show: "内核恐慌", title: "Vol.88 编译器的浪漫", date: "06-10", durationSec: 5400, status: "ready", readAt: 1750900000 },
  { id: "m8", url: "https://mock/e/m8", show: "疯投圈", title: "第 92 期:咖啡的生意经", date: "06-05", durationSec: 4800, status: "ready", readAt: 1750800000 },
];
let subs = [
  { pid: "mock-pid-1", title: "硬地骇客", lastPub: "2026-06-09T14:02:10.100Z" },
  { pid: "mock-pid-2", title: "张小珺Jùn｜商业访谈录", lastPub: "2026-07-06T10:00:00.000Z" },
];
const ttsStore = {}; // id -> {complete, segments:[{seq,key,path}]}
const correctionsStore = {}; // id -> [{original, corrected, evidenceUrl, confidence, ts}]
const peaksStore = {}; // id -> number[](波形峰值缓存,对应真后端的 peaks/<id>.json)
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
    return speechWavUrl(30); // 30 秒拟真波形充当"播客原声"
  },
  getPeaks: async (id) => peaksStore[id] ?? null,
  savePeaks: async (id, peaks) => { peaksStore[id] = peaks; },
  getSettings: async () => settings,
  setSettings: async (s) => { settings = { ...settings, ...s }; },
  setKeys: async (asrKey, llmKey, tavilyKey) => {
    const apply = (k, set, hint) => {
      if (k == null) return;
      settings = { ...settings, [set]: !!k, [hint]: k.slice(-4) };
    };
    apply(asrKey, "asrKeySet", "asrKeyHint");
    apply(llmKey, "llmKeySet", "llmKeyHint");
    apply(tavilyKey, "tavilyKeySet", "tavilyKeyHint");
  },
  // 连接自检:模拟网络往返;缺配置时以字符串 reject(与 Tauri 命令的错误形状一致)
  testAsrKey: async () => {
    await sleep(700);
    if (!settings.asrKeySet) throw "还没填百炼 API Key";
  },
  testLlm: async () => {
    await sleep(1100);
    if (!settings.llmKeySet) throw "缺少 LLM API Key";
    if (!settings.llmBaseUrl) throw "还没填 LLM 网关地址";
    if (!settings.llmModel) throw "还没填笔记模型";
  },
  testTavily: async () => {
    await sleep(700);
    if (!settings.tavilyKeySet) throw "还没填 Tavily API Key";
  },
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
  /** 划词纠正查证:canned verdict — 含 "面筋"/"Player" 返回已证实,其余返回推测 */
  researchTerm: async (_id, term) => {
    await sleep(1200);
    if (/players?/i.test(term)) {
      return { corrected: "No Priors", confidence: "confirmed", evidenceUrl: "https://www.no-priors.com/", note: "官方网站与各播客平台写法均为 No Priors" };
    }
    if (term.includes("面筋")) {
      return { corrected: term.replace(/面筋/g, "面基"), confidence: "confirmed", evidenceUrl: "https://www.xiaoyuzhoufm.com/", note: "小宇宙节目页写法为「面基」" };
    }
    if (term.length <= 2) return { corrected: null, confidence: "speculative", evidenceUrl: null, note: "没有找到更可信的写法" };
    return { corrected: `${term}(修)`, confidence: "speculative", evidenceUrl: null, note: "证据不足,仅为推测(mock)" };
  },
  applyCorrection: async (id, original, corrected, evidenceUrl, confidence) => {
    const note = notes[id]?.note;
    if (!note) throw "笔记还没生成";
    let n = 0;
    const rep = (s) => {
      const parts = String(s).split(original);
      n += parts.length - 1;
      return parts.join(corrected);
    };
    note.tldr = rep(note.tldr);
    note.points.forEach((p) => { p.h = rep(p.h); p.body = rep(p.body); });
    note.quotes.forEach((q) => { q.text = rep(q.text); });
    note.resources.forEach((r) => { r.name = rep(r.name); r.note = rep(r.note); });
    note.questions = note.questions.map(rep);
    (correctionsStore[id] ??= []).push({ original, corrected, evidenceUrl: evidenceUrl ?? null, confidence, ts: Math.floor(Date.now() / 1000) });
    delete ttsStore[id]; // 笔记变了,旧朗读作废
    return n;
  },
  getCorrections: async (id) => correctionsStore[id] ?? [],
  /** 块级核查:回放录制好的事件序列(fixtures/research-events.json),不花钱自测抽屉全过程 */
  researchBlocks: async (_id, _reqId, _blocks, onEvent) => {
    await replayEvents(researchEvents, onEvent);
  },
  cancelResearch: async () => {},
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
