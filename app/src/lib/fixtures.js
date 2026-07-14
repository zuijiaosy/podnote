// P0 静态样张数据:两集虚构笔记样张 + 三种状态假剧集(转写中/错误/排队)
// P2 接线后由 Rust library 的 get_library 替换
import ep125 from "../fixtures/ep125.json";
import ep143 from "../fixtures/ep143.json";
import { fmt } from "./format";

function fromNote(id, raw, date) {
  return {
    id,
    show: raw.meta.podcast,
    title: raw.meta.title,
    date,
    durationSec: raw.meta.durationSec,
    duration: fmt(raw.meta.durationSec),
    status: "ready",
    note: raw.note,
  };
}

/** 设计评审样张的静态波形峰值(确定性生成,只喂 DemoApp;实况模式一律真实解码) */
export const DEMO_PEAKS = (() => {
  const out = []; let s = 7;
  for (let i = 0; i < 110; i++) { s = (s * 16807) % 2147483647; out.push(0.25 + (s % 1000) / 1000 * 0.75); }
  return out;
})();

export const EPISODES = [
  fromNote("e1", ep125, "07-10"),
  {
    id: "e2", show: "晨间信号", title: "AI 会取代播客剪辑师吗",
    date: "07-08", durationSec: 1451, duration: "24:11",
    status: "processing", statusLabel: "转写中", elapsed: "04:37",
    note: null,
  },
  fromNote("e3", ep143, "07-02"),
  {
    id: "e4", show: "像素山谷", title: "芯片战争下半场:先进封装",
    date: "06-28", durationSec: 3922, duration: "1:05:22",
    status: "error", errStage: "RESOLVE",
    errReason: "没解析出音频地址,小宇宙页面结构可能变了",
    note: null,
  },
  {
    id: "e5", show: "回本为止", title: "茶饮出海:新茶饮在东南亚学到了什么",
    date: "06-21", durationSec: 4210, duration: "1:10:10",
    status: "off", statusLabel: "排队中", queuePos: 1,
    note: null,
  },
];
