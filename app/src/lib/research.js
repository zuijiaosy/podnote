// research — 块级核查会话:AgentEvent 流 → 时间线数据(ResearchDrawer 消费)
// 事件合同见 src-tauri/src/pipeline/agent.rs 的 AgentEvent,勿单方面改形状

/** 新会话骨架(发起核查时建) */
export function startSession(reqId, blockCount) {
  return { reqId, blockCount, status: "running", timeline: [], items: null, error: "" };
}

/**
 * 单个事件并入会话,返回新对象(直接喂 setState)。
 * 时间线元素: {kind:"round",n} | {kind:"text",text} | {kind:"tool",callId,name,args,status,hits,message}
 */
export function reduceEvent(s, ev) {
  if (!s || !ev) return s;
  const t = s.timeline;
  switch (ev.type) {
    case "round":
      // 第 1 轮不画分隔线(会话开头本身就是起点)
      return ev.n <= 1 ? s : { ...s, timeline: [...t, { kind: "round", n: ev.n }] };
    case "textDelta": {
      const last = t[t.length - 1];
      if (last?.kind === "text") {
        return { ...s, timeline: [...t.slice(0, -1), { ...last, text: last.text + ev.text }] };
      }
      return { ...s, timeline: [...t, { kind: "text", text: ev.text }] };
    }
    case "toolCall":
      return {
        ...s,
        timeline: [...t, {
          kind: "tool", callId: ev.callId, name: ev.name, args: ev.args ?? {},
          status: "running", hits: [], message: "",
        }],
      };
    case "toolResult": {
      const i = t.findIndex((x) => x.kind === "tool" && x.callId === ev.callId && x.status === "running");
      if (i < 0) return s;
      const next = [...t];
      next[i] = { ...next[i], status: ev.ok ? "done" : "error", hits: ev.hits ?? [], message: ev.message ?? "" };
      return { ...s, timeline: next };
    }
    case "final":
      return { ...s, status: "done", items: ev.items ?? [] };
    case "error":
      return { ...s, status: "error", error: ev.message || "核查失败" };
    default:
      return s;
  }
}

/** fixture 回放器(mock 模式/开发抽屉 UI 用):文本增量快,工具调用间停顿拟真 */
export async function replayEvents(events, onEvent) {
  const pause = { round: 300, toolCall: 250, toolResult: 900, final: 600, error: 300 };
  for (const ev of events) {
    if (ev.type === "textDelta") {
      // 整段文本切成小片流出,还原打字机效果
      for (const piece of ev.text.match(/.{1,6}/gs) ?? []) {
        onEvent({ type: "textDelta", text: piece });
        await new Promise((r) => setTimeout(r, 30));
      }
      continue;
    }
    await new Promise((r) => setTimeout(r, pause[ev.type] ?? 200));
    onEvent(ev);
  }
}
