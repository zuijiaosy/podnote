// 单集问答抽屉:转写稿全文上下文,流式回答,时间戳吸附引用可点回跳
// 与阅读井并排(440px,同 ResearchDrawer);问答记录是 append-only 日志,
// 内容(转写/笔记)更新后旧轮次可见但不再续入新请求的上下文——分隔线以下才是当前语境。
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "../components/core.jsx";
import { IndicatorLight, StatusLabel, Timestamp } from "../components/instrument.jsx";

const sans = {
  fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
  color: "var(--ink)", lineHeight: 1.7,
};
const mono = {
  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
  letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
};

const TS_RE = /\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g;
const fmtNum = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const sameRev = (r, cur) =>
  !!cur && r.revision?.transcriptHash === cur.transcriptHash && r.revision?.noteHash === cur.noteHash;

/** 行内渲染:**加粗** 与时间戳引用;全部 React 元素,不引入 HTML 字符串(注入边界) */
function inlineNodes(text, refs, onSeekSec) {
  let key = 0;
  /** 时间戳分段:返回节点数组(加粗内外都复用,加粗里的引用同样可点) */
  const tsNodes = (seg) => {
    const arr = [];
    let last = 0;
    for (const m of seg.matchAll(TS_RE)) {
      if (m.index > last) arr.push(<span key={key++}>{seg.slice(last, m.index)}</span>);
      const ts = m[0].slice(1, -1);
      const ref = refs?.find((r) => r.ts === ts);
      arr.push(
        ref ? (
          <Timestamp key={key++} time={ts} onSeek={() => onSeekSec(ref.sec)} style={{ margin: "0 2px" }} />
        ) : (
          <span key={key++}>{m[0]}</span>
        )
      );
      last = m.index + m[0].length;
    }
    if (last < seg.length) arr.push(<span key={key++}>{seg.slice(last)}</span>);
    return arr;
  };
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (m.index > last) out.push(...tsNodes(text.slice(last, m.index)));
    out.push(
      <strong key={key++} style={{ fontWeight: "var(--weight-medium)" }}>{tsNodes(m[1])}</strong>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...tsNodes(text.slice(last)));
  return out;
}

/** 回答正文:轻量 Markdown 子集(加粗/列表/标题行/空行),LLM 回答的常用格式全覆盖;
    吸附成功的时间戳渲染成可点的 Timestamp,吸不上的保持文字 */
function Answer({ text, refs, onSeekSec }) {
  return (
    <div style={{ ...sans, textWrap: "pretty", display: "flex", flexDirection: "column", gap: 4 }}>
      {text.split("\n").map((ln, i) => {
        const li = ln.match(/^\s*[-*]\s+(.*)$/);
        if (li) {
          return (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <span style={{ flex: "none", color: "var(--scale)" }}>·</span>
              <span style={{ flex: 1, minWidth: 0 }}>{inlineNodes(li[1], refs, onSeekSec)}</span>
            </div>
          );
        }
        const hd = ln.match(/^#{1,4}\s+(.*)$/);
        if (hd) {
          return (
            <div key={i} style={{ fontWeight: "var(--weight-medium)", marginTop: 4 }}>
              {inlineNodes(hd[1], refs, onSeekSec)}
            </div>
          );
        }
        if (ln.trim() === "") return <div key={i} style={{ height: 4 }} />;
        return <div key={i}>{inlineNodes(ln, refs, onSeekSec)}</div>;
      })}
    </div>
  );
}

/** 用量仪表:供应商没返回的字段显示"—",不推算 */
function UsageMeter({ usage }) {
  if (!usage) return null;
  return (
    <div style={{ ...mono, color: "var(--scale)" }}>
      输入 {fmtNum(usage.inputTokens)} · 缓存读 {fmtNum(usage.cacheReadTokens)} · 缓存写 {fmtNum(usage.cacheWriteTokens)} · 输出 {fmtNum(usage.outputTokens)}
    </div>
  );
}

function Round({ round, stale, onSeekSec }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <StatusLabel tone="dim">Q</StatusLabel>
        <span style={{ ...sans, fontWeight: "var(--weight-medium)", flex: 1 }}>{round.q}</span>
        {stale && <StatusLabel tone="dim">基于旧版内容</StatusLabel>}
      </div>
      <Answer text={round.a} refs={round.refs} onSeekSec={onSeekSec} />
      <UsageMeter usage={round.usage} />
    </div>
  );
}

/**
 * api: {get: () => Promise<{rounds, current, estInputTokens}>, ask(q, history, onEvent), cancel()}
 * prefill:划词「追问」/深挖问题点击预填;每次变化覆盖输入框
 */
export function QaDrawer({ ep, api, prefill, onSeekSec, onClose }) {
  const [rounds, setRounds] = useState(null); // null = 加载中
  const [current, setCurrent] = useState(null);
  const [est, setEst] = useState(0);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(null); // {q, text}
  const [err, setErr] = useState("");
  const scrollRef = useRef(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    api.get().then((qa) => {
      if (!alive) return;
      setRounds(qa.rounds);
      setCurrent(qa.current);
      setEst(qa.estInputTokens ?? 0);
    }).catch(() => alive && setRounds([]));
    return () => { alive = false; };
  }, [ep.id]);
  useEffect(() => { if (prefill) setInput(prefill); }, [prefill]);
  // 新内容进来贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rounds, streaming]);

  const ask = async (q) => {
    const question = q.trim();
    if (!question || streamingRef.current || rounds === null) return;
    streamingRef.current = true;
    setErr("");
    setInput("");
    // 上下文只带当前 revision 的轮次:旧回答不许污染新语境
    const history = rounds.filter((r) => sameRev(r, current)).map((r) => ({ q: r.q, a: r.a }));
    setStreaming({ q: question, text: "" });
    try {
      await api.ask(question, history, (e) => {
        if (e.type === "delta") {
          setStreaming((s) => (s ? { ...s, text: s.text + e.text } : s));
        } else if (e.type === "done") {
          setRounds((rs) => [...(rs ?? []), e.round]);
          setCurrent(e.round.revision); // 本轮 revision 即当前
        }
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      streamingRef.current = false;
      setStreaming(null);
    }
  };
  const abort = () => api.cancel();
  // 切集/关抽屉时中止进行中的提问
  useEffect(() => () => { if (streamingRef.current) api.cancel(); }, [ep.id]);

  // 分隔线位置:第一条与当前 revision 相同的轮次之前(它前面有旧轮次时)
  const rows = [];
  if (rounds) {
    let divided = false;
    rounds.forEach((r, i) => {
      const stale = !sameRev(r, current);
      if (!stale && !divided && i > 0) {
        divided = true;
        rows.push({ divider: true, key: `div-${i}` });
      }
      rows.push({ round: r, stale, key: i });
    });
    // 全是旧轮次:分隔线垫底,新对话从这往下开始
    if (rounds.length > 0 && !divided && rounds.every((r) => !sameRev(r, current))) {
      rows.push({ divider: true, key: "div-end" });
    }
  }

  const questions = ep.note?.questions ?? [];

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
        <IndicatorLight status={streaming ? "processing" : "ready"} label="问答" />
        <span style={{ ...mono, color: "var(--scale)" }}>约 {fmtNum(est)} tok/轮</span>
        <span style={{ flex: 1 }} />
        {streaming && <Button variant="ghost" size="sm" onClick={abort}>中止</Button>}
        <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px",
        display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box",
      }}>
        {rounds === null && <StatusLabel tone="dim">加载中…</StatusLabel>}
        {rounds?.length === 0 && !streaming && (
          <div style={{ ...sans, color: "var(--scale)" }}>
            对着这期节目提问,回答只依据转写稿,并带可回听的时间戳。
          </div>
        )}
        {rows.map((row) =>
          row.divider ? (
            <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...mono, color: "var(--scale)" }}>内容已更新 · 以上不再带入上下文</span>
              <span style={{ flex: 1, height: 1, background: "var(--line-faint)" }} />
            </div>
          ) : (
            <Round key={row.key} round={row.round} stale={row.stale} onSeekSec={onSeekSec} />
          )
        )}
        {streaming && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <StatusLabel tone="dim">Q</StatusLabel>
              <span style={{ ...sans, fontWeight: "var(--weight-medium)" }}>{streaming.q}</span>
            </div>
            <Answer text={streaming.text} refs={[]} onSeekSec={() => {}} />
            <span style={{
              display: "inline-block", width: 8, height: 14,
              background: "var(--scale)",
              animation: "pn-breathe 1s linear infinite",
            }} />
          </div>
        )}
        {err && err !== "已取消" && <div style={{ ...sans, color: "var(--signal)" }}>{err}</div>}
      </div>

      <div style={{
        flex: "none", display: "flex", flexDirection: "column", gap: 8,
        padding: "12px 20px 16px", borderTop: "1px solid var(--line-faint)",
      }}>
        {questions.length > 0 && !streaming && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {questions.map((q, i) => (
              <button
                key={i}
                onClick={() => setInput(q)}
                title={q}
                style={{
                  ...mono, color: "var(--scale)", padding: "3px 8px", cursor: "pointer",
                  background: "none", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)",
                  maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >Q{i + 1} {q}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <Input
            mono={false}
            value={input}
            placeholder="问点节目里聊过的…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
            style={{ flex: 1 }}
            aria-label="问答输入"
          />
          <Button variant="secondary" size="sm" onClick={() => ask(input)} disabled={!!streaming}>
            {streaming ? "回答中…" : "提问"}
          </Button>
        </div>
        <span style={{ ...mono, color: "var(--scale)" }}>
          每次提问都会把整期转写稿发给你的 LLM;历史只带"内容已更新"线以下的轮次
        </span>
      </div>
    </div>
  );
}
