// 右侧主视图:仪表头 + 阅读井(NOTES/TRANSCRIPT 双 tab) + 播放器
// 布局与「Podnote 正式设计 standalone.html」一致;who 归属为宪法 v2 修正新增
import { useEffect, useState } from "react";
import { Button } from "../components/core.jsx";
import { StatusLabel, IndicatorLight, Timestamp, Waveform } from "../components/instrument.jsx";
import { Transcript } from "./Transcript.jsx";
import { fmt } from "../lib/format.js";

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
function ReaderTabs({ ep, playFrac, onSeekFrac, transcript, onLoadTranscript, ttsSeg }) {
  const [tab, setTab] = useState("notes");
  useEffect(() => setTab("notes"), [ep.id]);
  useEffect(() => {
    if (tab === "transcript" && !transcript) onLoadTranscript?.();
  }, [tab, transcript, onLoadTranscript]);

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
      </div>
      {tab === "notes" ? (
        <Reader ep={ep} playFrac={playFrac} onSeekFrac={onSeekFrac} ttsSeg={ttsSeg} />
      ) : (
        <Transcript
          sentences={transcript}
          speakers={ep.note?.speakers}
          playSec={playFrac * ep.durationSec}
          onSeekSec={(sec) => onSeekFrac(sec / ep.durationSec)}
        />
      )}
    </div>
  );
}

function Reader({ ep, playFrac, onSeekFrac, ttsSeg }) {
  const note = ep.note;
  const mkSeek = (t) => () => onSeekFrac(t / ep.durationSec);
  const isActive = (t) => Math.abs(t / ep.durationSec - playFrac) < 0.015;
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
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
          }}>{note.tldr}</span>
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
              }}>{p.h}</span>
              <Who name={p.who} />
            </div>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
              color: "var(--ink)", lineHeight: "var(--leading-note)", textWrap: "pretty",
            }}>{p.body}</div>
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
            }}>「{q.text}」</span>
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
              }}>{r.name}</span>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
                color: "var(--scale)", lineHeight: 1.6,
              }}>{r.note}</span>
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
            }}>{q}</span>
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
  }}>{children}</div>
);
const Hint = ({ children, ink }) => (
  <div style={{
    fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
    color: ink ? "var(--ink)" : "var(--scale)", lineHeight: "var(--leading-note)",
    maxWidth: 400, textAlign: "center",
  }}>{children}</div>
);

export function NoteView({ ep, playFrac, playing, speed, bars, downloadPct, transcript, onLoadTranscript, onTogglePlay, onSeekFrac, onCycleSpeed, onToggleRead, tts, ttsSeg, onToggleTts, onCycleTtsRate, onRetry, onGoSettings }) {
  if (!ep) return null;
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
      <Console ep={ep} onToggleRead={onToggleRead} tts={tts} onToggleTts={onToggleTts} onCycleTtsRate={onCycleTtsRate} />
      {ep.status === "ready" && ep.note ? (
        <>
          <ReaderTabs
            ep={ep} playFrac={playFrac} onSeekFrac={onSeekFrac}
            transcript={transcript} onLoadTranscript={onLoadTranscript}
            ttsSeg={ttsSeg}
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
