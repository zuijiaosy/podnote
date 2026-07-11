// 右侧主视图:仪表头 + 阅读井(NOTES/TRANSCRIPT 双 tab) + 播放器
// 布局与「Podnote 正式设计 standalone.html」一致;who 归属为宪法 v2 修正新增
// 划词纠正:选中可疑词 → 浮层核实(LLM+搜索) → 确认替换全文;纠正过的词虚线下划线可溯源
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/core.jsx";
import { StatusLabel, IndicatorLight, Timestamp, Waveform } from "../components/instrument.jsx";
import { Transcript } from "./Transcript.jsx";
import { fmt } from "../lib/format.js";
import { openExternal } from "../lib/backend.js";

/** 纠正过的词加虚线下划线,悬停显示原词与依据;锚定正词(重生成后 LLM 直出正词,标记依然命中) */
function Marked({ text, corrections }) {
  if (!corrections?.length || !text) return text;
  const items = [...corrections]
    .filter((c) => c.corrected)
    .sort((a, b) => b.corrected.length - a.corrected.length); // 长词优先,防短词切碎长词
  let parts = [String(text)];
  for (const c of items) {
    parts = parts.flatMap((p) => {
      if (typeof p !== "string" || !p.includes(c.corrected)) return [p];
      const out = [];
      p.split(c.corrected).forEach((seg, i) => {
        if (i > 0) out.push({ word: c.corrected, c });
        if (seg) out.push(seg);
      });
      return out;
    });
  }
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <span
            key={i}
            title={`原词: ${p.c.original}${p.c.evidenceUrl ? `\n证据: ${p.c.evidenceUrl}` : ""}${p.c.confidence === "speculative" ? "\n(推测)" : ""}`}
            style={{ borderBottom: "1px dashed var(--scale)", cursor: "help" }}
          >
            {p.word}
          </span>
        )
      )}
    </>
  );
}

/** 右键菜单:核实选中词 / 继续多选(仅收起菜单,选区保留) */
function ContextMenu({ menu, onVerify, onClose }) {
  const item = (label, { disabled, onClick } = {}) => (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
        color: disabled ? "var(--scale)" : "var(--ink)",
        background: "transparent", border: "none", borderRadius: "var(--radius-sm)",
        padding: "8px 12px", textAlign: "left", cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--fill-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >{label}</button>
  );
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "absolute", top: menu.top, left: menu.left, zIndex: 3, minWidth: 160,
        background: "var(--panel)", border: "1px solid var(--line-soft)",
        borderRadius: "var(--radius)", padding: 4, boxSizing: "border-box",
        display: "flex", flexDirection: "column",
        animation: "pn-pop var(--dur) var(--ease) both",
      }}
    >
      {item(
        menu.term
          ? `核实「${menu.term.length > 16 ? `${menu.term.slice(0, 16)}…` : menu.term}」`
          : menu.tooLong ? "选中内容太长" : "先选中要核实的词",
        { disabled: !menu.term, onClick: onVerify }
      )}
      {item("继续多选", { onClick: onClose })}
    </div>
  );
}

/** 划词浮层:查证中(loading)→ 结论(done)→ 已替换(applied);error 可重试 */
function CorrectionPopover({ sel, phase, verdict, err, applyMsg, onResearch, onApply, onClose }) {
  const mono = {
    fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
    letterSpacing: "var(--tracking-machine)", color: "var(--ink)",
  };
  const hint = { fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)", lineHeight: 1.6 };
  const speculative = verdict?.confidence !== "confirmed";
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: sel.top, left: sel.left, width: 320, zIndex: 3,
        background: "var(--panel)", border: "1px solid var(--line-soft)",
        borderRadius: "var(--radius)", padding: "12px 16px", boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: 8,
        animation: "pn-pop var(--dur) var(--ease) both",
      }}
    >
      {phase === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IndicatorLight status="processing" label="查证中…" />
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
        </div>
      )}
      {phase === "done" && verdict?.corrected && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ ...mono, textDecoration: "line-through", color: "var(--scale)" }}>{sel.term}</span>
            <span style={{ ...mono, color: "var(--scale)" }}>→</span>
            <span style={{ ...mono, fontWeight: "var(--weight-medium)" }}>{verdict.corrected}</span>
            <span style={{ flex: 1 }} />
            <StatusLabel tone={speculative ? "dim" : "ready"}>
              {speculative ? "推测" : "已证实"}
            </StatusLabel>
          </div>
          {verdict.note && <div style={hint}>{verdict.note}{speculative ? " · 请自行判断" : ""}</div>}
          {verdict.evidenceUrl && (
            <button
              onClick={() => openExternal(verdict.evidenceUrl)}
              style={{
                ...hint, background: "transparent", border: "none", padding: 0,
                textAlign: "left", cursor: "pointer", textDecoration: "underline",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
              title={verdict.evidenceUrl}
            >{verdict.evidenceUrl}</button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="sm" onClick={onApply}>
              {speculative ? "仍要替换" : "替换全文"}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          </div>
        </>
      )}
      {phase === "done" && !verdict?.corrected && (
        <>
          <div style={hint}>未发现更可信的写法{verdict?.note ? ` · ${verdict.note}` : ""}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          </div>
        </>
      )}
      {phase === "error" && (
        <>
          <div style={{ ...hint, color: "var(--ink)" }}>{err}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="sm" onClick={onResearch}>重试</Button>
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          </div>
        </>
      )}
      {phase === "applied" && (
        <div style={{ ...mono, textAlign: "center" }}>{applyMsg}</div>
      )}
    </div>
  );
}

function Who({ name }) {
  if (!name) return null;
  return (
    <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)", flex: "none" }}>
      · {name}
    </span>
  );
}

function SectionHead({ idx, title }) {
  return (
    <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        letterSpacing: "var(--tracking-machine-wide)", color: "var(--scale)",
      }}>{idx}</span>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
        fontWeight: "var(--weight-medium)", color: "var(--ink)",
      }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: "var(--line-faint)" }} />
    </div>
  );
}

function Console({ ep, onToggleRead, tts, onToggleTts, onCycleTtsRate }) {
  const ttsLabel = tts?.gen?.error ? "朗读失败 · 重试"
    : tts?.waiting ? (tts?.gen ? `合成中 ${tts.gen.done + 1}/${tts.gen.total}` : "等待合成…")
    : tts?.playing ? "停止朗读" : "朗读";
  const statusLabel = ep.statusLabel
    || { ready: "READY", processing: "WORKING", error: "ERROR", off: "QUEUED" }[ep.status];
  return (
    <div style={{
      flex: "none", background: "var(--well)", borderRadius: "var(--radius)",
      padding: "16px 24px", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: 8,
      animation: "pn-enter var(--dur-slow) var(--ease) both",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)" }}>{ep.show}</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums", color: "var(--scale)",
        }}>{ep.date}</span>
      </div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "var(--text-xl)",
        fontWeight: "var(--weight-medium)", color: "var(--ink)", lineHeight: "var(--leading-tight)",
      }}>{ep.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <IndicatorLight status={ep.status} label={statusLabel} />
        <span style={{ flex: 1 }} />
        {ep.status === "ready" && (
          <>
            {(tts?.playing || tts?.waiting) && (
              <Button variant="ghost" size="sm" onClick={() => onCycleTtsRate?.()}>
                {`${tts?.rate ?? 1.5}×`}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onToggleTts?.()}>{ttsLabel}</Button>
          </>
        )}
        <Button variant="ghost" size="sm" title="快捷键 E" onClick={() => onToggleRead?.()}>
          {ep.readAt ? "已归档 · 撤销" : "归档"}
        </Button>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums", color: "var(--scale)",
        }}>{ep.duration}</span>
      </div>
    </div>
  );
}

/** 阅读井容器:NOTES(笔记,默认) / TRANSCRIPT(逐句字幕) 双 tab */
function ReaderTabs({ ep, playFrac, onSeekFrac, transcript, onLoadTranscript, ttsSeg, onRegenerateNote, onRegenerateTranscript, corrections, onResearchTerm, onApplyCorrection }) {
  const [tab, setTab] = useState("notes");
  useEffect(() => setTab("notes"), [ep.id]);
  useEffect(() => {
    if (tab === "transcript" && !transcript) onLoadTranscript?.();
  }, [tab, transcript, onLoadTranscript]);

  // 重跑要花钱:两击确认,3 秒不确认自动复位;切 tab/换剧集也复位
  const [confirm, setConfirm] = useState(false);
  const confirmTimer = useRef(null);
  useEffect(() => {
    setConfirm(false);
    clearTimeout(confirmTimer.current);
  }, [tab, ep.id]);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);
  const regenClick = () => {
    if (!confirm) {
      setConfirm(true);
      confirmTimer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    clearTimeout(confirmTimer.current);
    setConfirm(false);
    (tab === "notes" ? onRegenerateNote : onRegenerateTranscript)?.();
  };

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      style={{
        fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
        fontWeight: "var(--weight-medium)",
        letterSpacing: "var(--tracking-machine)",
        background: "transparent", border: "none",
        borderBottom: tab === id ? "2px solid var(--ink)" : "2px solid transparent",
        color: tab === id ? "var(--ink)" : "var(--scale)",
        padding: "6px 10px 10px", cursor: "pointer",
        transition: "color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
      }}
    >{label}</button>
  );

  return (
    <div style={{
      flex: 1, minHeight: 0, background: "var(--well)", borderRadius: "var(--radius)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        flex: "none", display: "flex", gap: 8, padding: "12px 24px 0",
        borderBottom: "1px solid var(--line-faint)",
      }}>
        {tabBtn("notes", "笔记")}
        {tabBtn("transcript", "字幕")}
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost" size="sm"
          title={tab === "notes" ? "换模型后重跑笔记,不重新转写" : "重新云端转写并重新生成笔记,耗时几分钟"}
          onClick={regenClick}
          style={{ alignSelf: "center", marginBottom: 6 }}
        >
          {confirm ? "确认重跑?" : tab === "notes" ? "重新生成" : "重新转写"}
        </Button>
      </div>
      {tab === "notes" ? (
        <Reader
          key={ep.id} ep={ep} playFrac={playFrac} onSeekFrac={onSeekFrac} ttsSeg={ttsSeg}
          corrections={corrections} onResearchTerm={onResearchTerm} onApplyCorrection={onApplyCorrection}
        />
      ) : (
        <Transcript
          key={ep.id}
          sentences={transcript}
          speakers={ep.note?.speakers}
          playSec={playFrac * ep.durationSec}
          onSeekSec={(sec) => onSeekFrac(sec / ep.durationSec)}
        />
      )}
    </div>
  );
}

function Reader({ ep, playFrac, onSeekFrac, ttsSeg, corrections, onResearchTerm, onApplyCorrection }) {
  const note = ep.note;
  const mkSeek = (t) => () => onSeekFrac(t / ep.durationSec);
  const isActive = (t) => Math.abs(t / ep.durationSec - playFrac) < 0.015;
  const contRef = useRef(null);
  // 朗读到哪段,视口跟到哪段
  useEffect(() => {
    if (!ttsSeg) return;
    document.querySelector(`[data-tts="${ttsSeg}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [ttsSeg]);
  /** 卡片类块(自带底色)的朗读高亮 */
  const hl = (key) => (ttsSeg === key
    ? { background: "var(--fill-active)", outline: "1px solid var(--line-soft)" }
    : {});
  /** 纠正标记:文本统一经 Marked 渲染 */
  const M = (text) => <Marked text={text} corrections={corrections} />;

  // ===== 划词纠正:选中 → 右键菜单「核实」→ 浮层(都在滚动内容里,随文滚动) =====
  const [menu, setMenu] = useState(null); // {term, context, tooLong, top, left}
  const [sel, setSel] = useState(null); // {term, context, top, left}
  const [phase, setPhase] = useState("loading");
  const [verdict, setVerdict] = useState(null);
  const [err, setErr] = useState("");
  const [applyMsg, setApplyMsg] = useState("");
  const reqRef = useRef(0);
  const closeSel = () => { reqRef.current += 1; setSel(null); setMenu(null); setVerdict(null); setErr(""); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") closeSel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 右键 → 自定义菜单(选区保留;「继续多选」仅收起菜单) */
  const onContextMenu = (e) => {
    const cont = contRef.current;
    if (!cont) return;
    e.preventDefault();
    const s = window.getSelection();
    let text = (s?.toString() ?? "").trim().replace(/\s*\n\s*/g, " ");
    let tooLong = false;
    if (text.length > 60) {
      text = "";
      tooLong = true;
    }
    // 语境:选区所在文本节点前后各 ~80 字,供查证 LLM 定位
    let context = "";
    if (text && s.rangeCount > 0) {
      const range = s.getRangeAt(0);
      if (!cont.contains(range.commonAncestorContainer)) return;
      const para = range.startContainer.textContent || "";
      const idx = para.indexOf(text);
      context = idx >= 0
        ? para.slice(Math.max(0, idx - 80), idx + text.length + 80)
        : para.slice(0, 160);
    }
    const cr = cont.getBoundingClientRect();
    const top = e.clientY - cr.top + cont.scrollTop + 4;
    const left = Math.min(Math.max(e.clientX - cr.left + cont.scrollLeft, 8), Math.max(cr.width - 300, 8));
    reqRef.current += 1;
    setSel(null);
    setVerdict(null);
    setErr("");
    setMenu({ term: text, context, tooLong, top, left });
  };

  const research = async (target) => {
    const req = ++reqRef.current;
    setPhase("loading");
    setErr("");
    try {
      const v = await onResearchTerm(target.term, target.context);
      if (reqRef.current !== req) return; // 已关闭/换词,丢弃过期结果
      setVerdict(v);
      setPhase("done");
    } catch (e) {
      if (reqRef.current !== req) return;
      setErr(String(e));
      setPhase("error");
    }
  };
  /** 菜单选「核实」:菜单原位换成查证浮层,立即发起查证 */
  const verifyFromMenu = () => {
    if (!menu?.term) return;
    const target = { term: menu.term, context: menu.context, top: menu.top, left: menu.left };
    setMenu(null);
    setSel(target);
    research(target);
  };
  const doResearch = () => { if (sel) research(sel); }; // error 态「重试」
  const doApply = async () => {
    if (!sel || !verdict?.corrected) return;
    const req = reqRef.current;
    try {
      const n = await onApplyCorrection(sel.term, verdict.corrected, verdict.evidenceUrl ?? null, verdict.confidence);
      if (reqRef.current !== req) return;
      setApplyMsg(n > 0 ? `已替换 ${n} 处` : "已记入词表");
      setPhase("applied");
      setTimeout(() => closeSel(), 900);
    } catch (e) {
      if (reqRef.current !== req) return;
      setErr(String(e));
      setPhase("error");
    }
  };

  return (
    <div
      ref={contRef}
      onContextMenu={onContextMenu}
      onMouseDown={() => { if (menu) setMenu(null); }}
      style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative", animation: "pn-enter var(--dur-slow) var(--ease) both" }}
    >
      {menu && <ContextMenu menu={menu} onVerify={verifyFromMenu} onClose={() => setMenu(null)} />}
      {sel && (
        <CorrectionPopover
          sel={sel} phase={phase} verdict={verdict} err={err} applyMsg={applyMsg}
          onResearch={doResearch} onApply={doApply} onClose={closeSel}
        />
      )}
      <div style={{ maxWidth: 648, margin: "0 auto", padding: "24px 40px 48px", boxSizing: "border-box" }}>
        <div data-tts="tldr" style={{
          background: "var(--panel)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", padding: "16px 24px",
          display: "flex", flexDirection: "column", gap: 8,
          transition: "background var(--dur) var(--ease)",
          ...hl("tldr"),
        }}>
          <StatusLabel tone="dim">一句话</StatusLabel>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-medium)", color: "var(--ink)", lineHeight: 1.6,
          }}>{M(note.tldr)}</span>
        </div>

        <SectionHead idx="01" title="核心观点" />
        {note.points.map((p, i) => (
          <div key={i} data-tts={`point-${i}`} style={{
            display: "flex", flexDirection: "column", gap: 8,
            borderRadius: "var(--radius)",
            transition: "background var(--dur) var(--ease)",
            // 负外边距 + 等量内边距:高亮出现底色时文字不位移
            ...(ttsSeg === `point-${i}`
              ? { background: "var(--fill-active)", padding: "12px 16px", margin: "12px -16px 0" }
              : { padding: 0, margin: "24px 0 0" }),
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Timestamp time={p.ts} active={isActive(p.t)} onSeek={mkSeek(p.t)} />
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
                fontWeight: "var(--weight-medium)", color: "var(--ink)", minWidth: 0,
              }}>{M(p.h)}</span>
              <Who name={p.who} />
            </div>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
              color: "var(--ink)", lineHeight: "var(--leading-note)", textWrap: "pretty",
            }}>{M(p.body)}</div>
          </div>
        ))}

        <SectionHead idx="02" title="值得记住的话" />
        {note.quotes.map((q, i) => (
          <div key={i} data-tts={`quote-${i}`} style={{
            marginTop: 16, background: "var(--panel)", borderRadius: "var(--radius)",
            padding: "16px 24px", display: "flex", flexDirection: "column", gap: 8,
            transition: "background var(--dur) var(--ease)",
            ...hl(`quote-${i}`),
          }}>
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
              color: "var(--ink)", lineHeight: "var(--leading-note)",
            }}>「{M(q.text)}」</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Timestamp time={q.ts} active={isActive(q.t)} onSeek={mkSeek(q.t)} />
              <Who name={q.who} />
            </div>
          </div>
        ))}

        <SectionHead idx="03" title="提到的资源" />
        <div style={{ marginTop: 8 }}>
          {note.resources.length === 0 && (
            <div style={{ padding: "12px 0", fontFamily: "var(--font-sans)", fontSize: "var(--text-base)", color: "var(--scale)" }}>无</div>
          )}
          {note.resources.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "baseline", gap: 16,
              padding: "12px 0", borderBottom: "1px solid var(--line-faint)",
            }}>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
                fontWeight: "var(--weight-medium)", color: "var(--ink)", flex: "none",
              }}>{M(r.name)}</span>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
                color: "var(--scale)", lineHeight: 1.6,
              }}>{M(r.note)}</span>
            </div>
          ))}
        </div>

        <SectionHead idx="04" title="我可能想深挖的" />
        {note.questions.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "baseline" }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              letterSpacing: "var(--tracking-machine)", color: "var(--scale)", flex: "none",
            }}>Q{i + 1}</span>
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
              color: "var(--ink)", lineHeight: "var(--leading-note)",
            }}>{M(q)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 走带图标:▶ 播放 / ⏸ 暂停(CSS 绘制,不引图标库) */
function PlayGlyph() {
  return (
    <span style={{
      width: 0, height: 0, borderStyle: "solid",
      borderWidth: "8px 0 8px 13px",
      borderColor: "transparent transparent transparent var(--ink)",
      marginLeft: 3, // 三角形视觉居中补偿
    }} />
  );
}
function PauseGlyph() {
  return (
    <span style={{ display: "flex", gap: 4 }}>
      <i style={{ display: "block", width: 4, height: 15, background: "var(--ink)" }} />
      <i style={{ display: "block", width: 4, height: 15, background: "var(--ink)" }} />
    </span>
  );
}

function Player({ ep, playFrac, playing, speed, downloadPct, onTogglePlay, onSeekFrac, onCycleSpeed, bars }) {
  const anchors = ep.note ? ep.note.points.map((p) => p.t / ep.durationSec) : [];
  const downloading = downloadPct != null;
  return (
    <div style={{
      flex: "none", background: "var(--well)", borderRadius: "var(--radius)",
      padding: "16px 24px", boxSizing: "border-box",
      display: "flex", alignItems: "center", gap: 16,
    }}>
      <Button
        variant="secondary"
        onClick={downloading ? undefined : onTogglePlay}
        style={{
          flex: "none", width: 52, height: 40, padding: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          opacity: downloading ? 0.7 : 1,
        }}
        aria-label={downloading ? "音频下载中" : playing ? "暂停" : "播放"}
        title={playing ? "暂停(回车)" : "播放(回车)"}
      >
        {downloading
          ? <span style={{ fontSize: "var(--text-xs)", fontVariantNumeric: "tabular-nums" }}>{downloadPct}%</span>
          : playing ? <PauseGlyph /> : <PlayGlyph />}
      </Button>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
        letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
        color: "var(--ink)", flex: "none",
      }}>{fmt(playFrac * ep.durationSec)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Waveform bars={bars} progress={playFrac} anchors={anchors} height={40} onSeek={onSeekFrac} />
      </div>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
        letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
        color: "var(--scale)", flex: "none",
      }}>{ep.duration}</span>
      <Button
        variant="secondary" onClick={onCycleSpeed}
        style={{
          flex: "none", width: 60, height: 40, padding: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: "var(--text-sm)",
        }}
        title="切换倍速"
      >
        {speed.toFixed(1)}×
      </Button>
    </div>
  );
}

const STAGE_ZH = { KEY: "密钥", RESOLVE: "解析", TRANSCRIBE: "转写", SUMMARIZE: "生成笔记" };

/** 非就绪态的右侧井:处理中 / 错误 / 排队 */
function StateWell({ ep, onRetry, onGoSettings }) {
  if (ep.status === "processing") {
    return (
      <Center>
        <IndicatorLight status="processing" label={ep.statusLabel || "运行中"} />
        {ep.elapsed && (
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)",
            letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums", color: "var(--ink)",
          }}>{ep.elapsed}</div>
        )}
        <Hint>云端处理中,通常需要几分钟。完成后笔记出现在这里。</Hint>
      </Center>
    );
  }
  if (ep.status === "error") {
    const needsKey = ep.errStage === "KEY";
    return (
      <Center>
        <IndicatorLight status="error" label={`${STAGE_ZH[ep.errStage] ?? "管线"}失败`} />
        <Hint ink>{ep.errReason}</Hint>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          {needsKey
            ? <Button variant="secondary" size="sm" onClick={onGoSettings}>去设置</Button>
            : <Button variant="secondary" size="sm" onClick={onRetry}>重试</Button>}
        </div>
      </Center>
    );
  }
  return (
    <Center>
      <IndicatorLight status="off" label="排队中" />
      <Hint>排在队列里,前面的磁带处理完成后自动开始。</Hint>
    </Center>
  );
}
const Center = ({ children }) => (
  <div style={{
    flex: 1, background: "var(--well)", borderRadius: "var(--radius)",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
    animation: "pn-enter var(--dur-slow) var(--ease) both",
  }}>{children}</div>
);
const Hint = ({ children, ink }) => (
  <div style={{
    fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
    color: ink ? "var(--ink)" : "var(--scale)", lineHeight: "var(--leading-note)",
    maxWidth: 400, textAlign: "center",
  }}>{children}</div>
);

export function NoteView({ ep, playFrac, playing, speed, bars, downloadPct, transcript, onLoadTranscript, onTogglePlay, onSeekFrac, onCycleSpeed, onToggleRead, tts, ttsSeg, onToggleTts, onCycleTtsRate, onRegenerateNote, onRegenerateTranscript, corrections, onResearchTerm, onApplyCorrection, onRetry, onGoSettings }) {
  if (!ep) return null;
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
      <Console key={ep.id} ep={ep} onToggleRead={onToggleRead} tts={tts} onToggleTts={onToggleTts} onCycleTtsRate={onCycleTtsRate} />
      {ep.status === "ready" && ep.note ? (
        <>
          <ReaderTabs
            ep={ep} playFrac={playFrac} onSeekFrac={onSeekFrac}
            transcript={transcript} onLoadTranscript={onLoadTranscript}
            ttsSeg={ttsSeg}
            onRegenerateNote={onRegenerateNote}
            onRegenerateTranscript={onRegenerateTranscript}
            corrections={corrections}
            onResearchTerm={onResearchTerm}
            onApplyCorrection={onApplyCorrection}
          />
          <Player
            ep={ep} playFrac={playFrac} playing={playing} speed={speed} bars={bars} downloadPct={downloadPct}
            onTogglePlay={onTogglePlay} onSeekFrac={onSeekFrac} onCycleSpeed={onCycleSpeed}
          />
        </>
      ) : (
        <StateWell ep={ep} onRetry={onRetry} onGoSettings={onGoSettings} />
      )}
    </div>
  );
}
