// 块级核查抽屉:agent 全过程时间线(叙述 + 搜索卡片) + 终局修正表(逐行/批量应用)
// 与阅读井并排(440px)可对照原文;会话数据形状见 lib/research.js;关抽屉 = 取消 agent
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/core.jsx";
import { IndicatorLight, StatusLabel } from "../components/instrument.jsx";
import { openExternal } from "../lib/backend.js";

const sans = {
  fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
  color: "var(--ink)", lineHeight: 1.7,
};
const mono = {
  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
  letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
};
const monoSm = {
  fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
  letterSpacing: "var(--tracking-machine)", color: "var(--ink)",
};

/** 搜索卡片:query + 状态灯,有命中时点击展开 */
function ToolCard({ item }) {
  const [open, setOpen] = useState(false);
  const query = item.args?.query ?? JSON.stringify(item.args);
  const status = item.status === "running" ? "processing" : item.status === "done" ? "ready" : "error";
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--line-soft)",
      borderRadius: "var(--radius)", padding: "8px 12px", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: 8,
      animation: "pn-pop var(--dur) var(--ease) both",
    }}>
      <button
        onClick={() => item.hits.length && setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8, minWidth: 0,
          background: "transparent", border: "none", padding: 0,
          cursor: item.hits.length ? "pointer" : "default", textAlign: "left",
        }}
      >
        <IndicatorLight status={status} />
        <span style={{ ...mono, color: "var(--scale)", flex: "none" }}>{item.name}</span>
        <span
          title={query}
          style={{ ...mono, color: "var(--ink)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >{query}</span>
        {item.hits.length > 0 && (
          <span style={{ ...mono, color: "var(--scale)", flex: "none" }}>{open ? "收起" : `${item.hits.length} 条`}</span>
        )}
      </button>
      {item.status === "error" && item.message && (
        <div style={{ ...sans, color: "var(--scale)" }}>{item.message}</div>
      )}
      {open && item.hits.map((h, i) => (
        <div key={i} style={{
          display: "flex", flexDirection: "column", gap: 2,
          paddingLeft: 12, borderLeft: "2px solid var(--line-faint)",
        }}>
          <button
            onClick={() => openExternal(h.url)}
            title={h.url}
            style={{
              ...sans, fontWeight: "var(--weight-medium)", background: "transparent",
              border: "none", padding: 0, textAlign: "left", cursor: "pointer",
              textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >{h.title || h.url}</button>
          <span style={{
            ...sans, color: "var(--scale)",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{h.content}</span>
        </div>
      ))}
    </div>
  );
}

/** 修正表行:corrected 为空 = 核实无误(无应用按钮);state 为该行应用进度 */
function SuggestionRow({ item, state, onApply }) {
  const speculative = item.confidence !== "confirmed";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 0", borderBottom: "1px solid var(--line-faint)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {item.corrected ? (
          <>
            <span style={{ ...monoSm, textDecoration: "line-through", color: "var(--scale)" }}>{item.original}</span>
            <span style={{ ...monoSm, color: "var(--scale)" }}>→</span>
            <span style={{ ...monoSm, fontWeight: "var(--weight-medium)" }}>{item.corrected}</span>
          </>
        ) : (
          <span style={monoSm}>{item.original}</span>
        )}
        <span style={{ flex: 1 }} />
        {item.corrected
          ? <StatusLabel tone={speculative ? "dim" : "ready"}>{speculative ? "推测" : "已证实"}</StatusLabel>
          : <StatusLabel tone="ready">无误</StatusLabel>}
      </div>
      {item.note && <div style={{ ...sans, color: "var(--scale)" }}>{item.note}{item.corrected && speculative ? " · 请自行判断" : ""}</div>}
      {item.evidenceUrl && (
        <button
          onClick={() => openExternal(item.evidenceUrl)}
          title={item.evidenceUrl}
          style={{
            ...sans, color: "var(--scale)", background: "transparent", border: "none", padding: 0,
            textAlign: "left", cursor: "pointer", textDecoration: "underline",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >{item.evidenceUrl}</button>
      )}
      {item.corrected && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
          {state?.phase === "applied" ? (
            <span style={{ ...monoSm, color: "var(--scale)" }}>{state.msg}</span>
          ) : state?.phase === "error" ? (
            <>
              <span style={{ ...sans, color: "var(--scale)", flex: 1, minWidth: 0 }}>{state.msg}</span>
              <Button variant="secondary" size="sm" onClick={onApply}>重试</Button>
            </>
          ) : (
            <Button
              variant="secondary" size="sm"
              onClick={state?.phase === "applying" ? undefined : onApply}
              style={state?.phase === "applying" ? { opacity: 0.6 } : undefined}
            >
              {state?.phase === "applying" ? "应用中…" : speculative ? "仍要应用" : "应用"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * session: {reqId, blockCount, status, timeline, items, error}(lib/research.js)
 * onApply(original, corrected, evidenceUrl, confidence) → 替换处数(App 的 onApplyCorrection)
 */
export function ResearchDrawer({ session, onAbort, onClose, onApply }) {
  const scrollRef = useRef(null);
  const [applyMap, setApplyMap] = useState({}); // original → {phase, msg}
  const [bulk, setBulk] = useState(false);
  useEffect(() => { setApplyMap({}); setBulk(false); }, [session.reqId]);
  // 运行中新内容进来自动贴底
  useEffect(() => {
    if (session.status !== "running") return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.timeline, session.status]);

  const applyOne = async (item) => {
    setApplyMap((m) => ({ ...m, [item.original]: { phase: "applying" } }));
    try {
      const n = await onApply(item.original, item.corrected, item.evidenceUrl ?? null, item.confidence);
      setApplyMap((m) => ({ ...m, [item.original]: { phase: "applied", msg: n > 0 ? `已替换 ${n} 处` : "已记入词表" } }));
    } catch (e) {
      setApplyMap((m) => ({ ...m, [item.original]: { phase: "error", msg: String(e) } }));
    }
  };
  // 批量应用只收已证实的;串行执行(App 侧每次应用后重拉笔记,并发会竞态)
  const pendingConfirmed = (session.items ?? []).filter(
    (it) => it.corrected && it.confidence === "confirmed" && applyMap[it.original]?.phase !== "applied"
  );
  const applyAll = async () => {
    setBulk(true);
    for (const it of pendingConfirmed) await applyOne(it);
    setBulk(false);
  };

  const [lightStatus, lightLabel] =
    session.status === "running" ? ["processing", "核查中"]
    : session.status === "done" ? ["ready", "完成"]
    : ["error", "出错"];

  return (
    <div style={{
      flex: "none", width: 440, background: "var(--well)", borderRadius: "var(--radius)",
      boxSizing: "border-box", display: "flex", flexDirection: "column", minHeight: 0,
      animation: "pn-enter var(--dur-slow) var(--ease) both",
    }}>
      <div style={{
        flex: "none", display: "flex", alignItems: "center", gap: 12,
        padding: "14px 20px", borderBottom: "1px solid var(--line-faint)",
      }}>
        <IndicatorLight status={lightStatus} label={lightLabel} />
        <span style={{ ...mono, color: "var(--scale)" }}>{session.blockCount} 个分块</span>
        <span style={{ flex: 1 }} />
        {session.status === "running" && (
          <Button variant="ghost" size="sm" onClick={onAbort}>中止</Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px",
        display: "flex", flexDirection: "column", gap: 12, boxSizing: "border-box",
      }}>
        {session.timeline.map((item, i) =>
          item.kind === "text" ? (
            <div key={i} style={{ ...sans, whiteSpace: "pre-wrap", textWrap: "pretty" }}>{item.text}</div>
          ) : item.kind === "tool" ? (
            <ToolCard key={i} item={item} />
          ) : (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ ...mono, color: "var(--scale)" }}>ROUND {item.n}</span>
              <span style={{ flex: 1, height: 1, background: "var(--line-faint)" }} />
            </div>
          )
        )}
        {session.status === "error" && <div style={sans}>{session.error}</div>}
        {session.items && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <StatusLabel tone="dim">修正表</StatusLabel>
              <span style={{ flex: 1, height: 1, background: "var(--line-faint)" }} />
            </div>
            {session.items.length === 0 && (
              <div style={{ ...sans, color: "var(--scale)", padding: "10px 0" }}>没有发现需要修正的专有名词</div>
            )}
            {session.items.map((it) => (
              <SuggestionRow key={it.original} item={it} state={applyMap[it.original]} onApply={() => applyOne(it)} />
            ))}
          </div>
        )}
      </div>

      {session.status === "done" && pendingConfirmed.length > 0 && (
        <div style={{
          flex: "none", display: "flex", justifyContent: "flex-end",
          padding: "12px 20px", borderTop: "1px solid var(--line-faint)",
        }}>
          <Button
            variant="secondary" size="sm"
            onClick={bulk ? undefined : applyAll}
            style={bulk ? { opacity: 0.6 } : undefined}
          >
            {bulk ? "应用中…" : `全部应用 · 仅已证实(${pendingConfirmed.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}
