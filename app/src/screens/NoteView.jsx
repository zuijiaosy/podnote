// 右侧主视图:仪表头 + 阅读井(五段式笔记,带说话人归属) + 播放器
// 布局与「Podnote 正式设计 standalone.html」一致;who 归属为宪法 v2 修正新增
import { Button } from "../components/core.jsx";
import { StatusLabel, IndicatorLight, Timestamp, Waveform } from "../components/instrument.jsx";
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

function Console({ ep }) {
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
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums", color: "var(--scale)",
        }}>{ep.duration}</span>
      </div>
    </div>
  );
}

function Reader({ ep, playFrac, onSeekFrac }) {
  const note = ep.note;
  const mkSeek = (t) => () => onSeekFrac(t / ep.durationSec);
  const isActive = (t) => Math.abs(t / ep.durationSec - playFrac) < 0.015;
  return (
    <div style={{
      flex: 1, minHeight: 0, background: "var(--well)", borderRadius: "var(--radius)", overflow: "auto",
    }}>
      <div style={{ maxWidth: 648, margin: "0 auto", padding: "32px 40px 48px", boxSizing: "border-box" }}>
        <div style={{
          background: "var(--panel)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", padding: "16px 24px",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <StatusLabel tone="dim">TL;DR</StatusLabel>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-medium)", color: "var(--ink)", lineHeight: 1.6,
          }}>{note.tldr}</span>
        </div>

        <SectionHead idx="01" title="核心观点" />
        {note.points.map((p, i) => (
          <div key={i} style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
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
          <div key={i} style={{
            marginTop: 16, background: "var(--panel)", borderRadius: "var(--radius)",
            padding: "16px 24px", display: "flex", flexDirection: "column", gap: 8,
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

function Player({ ep, playFrac, playing, speed, onTogglePlay, onSeekFrac, onCycleSpeed, bars }) {
  const anchors = ep.note ? ep.note.points.map((p) => p.t / ep.durationSec) : [];
  return (
    <div style={{
      flex: "none", background: "var(--well)", borderRadius: "var(--radius)",
      padding: "16px 24px", boxSizing: "border-box",
      display: "flex", alignItems: "center", gap: 16,
    }}>
      <Button variant="secondary" size="sm" onClick={onTogglePlay} style={{ flex: "none", width: 64 }}>
        {playing ? "PAUSE" : "PLAY"}
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
      <Button variant="secondary" size="sm" onClick={onCycleSpeed} style={{ flex: "none", width: 56 }}>
        {speed.toFixed(1)}X
      </Button>
    </div>
  );
}

/** 非就绪态的右侧井:转写中 / 错误 / 排队 */
function StateWell({ ep, onRetry, onGoSettings }) {
  if (ep.status === "processing") {
    return (
      <Center>
        <IndicatorLight status="processing" label={ep.statusLabel || "WORKING"} />
        {ep.elapsed && (
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)",
            letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums", color: "var(--ink)",
          }}>{ep.elapsed}</div>
        )}
        <Hint>云端转写中,通常需要几分钟。完成后笔记出现在这里。</Hint>
      </Center>
    );
  }
  if (ep.status === "error") {
    const needsKey = ep.errStage === "KEY";
    return (
      <Center>
        <IndicatorLight status="error" label={`${ep.errStage || "PIPELINE"} FAILED`} />
        <Hint ink>{ep.errReason}</Hint>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          {needsKey
            ? <Button variant="secondary" size="sm" onClick={onGoSettings}>GO TO SETTINGS</Button>
            : <Button variant="secondary" size="sm" onClick={onRetry}>RETRY</Button>}
        </div>
      </Center>
    );
  }
  return (
    <Center>
      <IndicatorLight status="off" label="QUEUED" />
      <Hint>排在第 {ep.queuePos ?? 1} 位。前面的磁带处理完成后自动开始。</Hint>
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

export function NoteView({ ep, playFrac, playing, speed, bars, onTogglePlay, onSeekFrac, onCycleSpeed, onRetry, onGoSettings }) {
  if (!ep) return null;
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
      <Console ep={ep} />
      {ep.status === "ready" && ep.note ? (
        <>
          <Reader ep={ep} playFrac={playFrac} onSeekFrac={onSeekFrac} />
          <Player
            ep={ep} playFrac={playFrac} playing={playing} speed={speed} bars={bars}
            onTogglePlay={onTogglePlay} onSeekFrac={onSeekFrac} onCycleSpeed={onCycleSpeed}
          />
        </>
      ) : (
        <StateWell ep={ep} onRetry={onRetry} onGoSettings={onGoSettings} />
      )}
    </div>
  );
}
