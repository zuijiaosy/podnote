// Transcript — 逐句字幕视图:当前句高亮 + 自动跟随滚动 + 点句跳播
// 手动滚动(滚轮/触控板)即暂停跟随,右上角 FOLLOW 一键回到当前句
import { useEffect, useMemo, useRef, useState } from "react";

export function Transcript({ sentences, speakers, playSec, onSeekSec }) {
  const [follow, setFollow] = useState(true);
  const currentRef = useRef(null);

  const currentIdx = useMemo(() => {
    if (!sentences?.length) return -1;
    let lo = 0, hi = sentences.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sentences[mid].t <= playSec) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }, [sentences, playSec]);

  useEffect(() => {
    if (follow && currentRef.current) {
      currentRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentIdx, follow]);

  if (!sentences) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine-wide)", color: "var(--scale)",
        }}>加载中…</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      {!follow && (
        <button
          onClick={() => setFollow(true)}
          style={{
            position: "absolute", top: 8, right: 24, zIndex: 2,
            fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            letterSpacing: "var(--tracking-machine)", textTransform: "uppercase",
            background: "var(--ink)", color: "var(--panel)",
            border: "none", borderRadius: "var(--radius-sm)",
            padding: "4px 10px", cursor: "pointer",
          }}
        >◉ 跟随播放</button>
      )}
      <div
        onWheel={() => setFollow(false)}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        <div style={{ maxWidth: 648, margin: "0 auto", padding: "16px 40px 48px", boxSizing: "border-box" }}>
          {sentences.map((s, i) => {
            const current = i === currentIdx;
            return (
              <div
                key={i}
                ref={current ? currentRef : null}
                onClick={() => onSeekSec(s.t)}
                style={{
                  display: "flex", alignItems: "baseline", gap: 12,
                  padding: "6px 12px", borderRadius: "var(--radius)",
                  background: current ? "var(--fill-active)" : "transparent",
                  cursor: "pointer",
                  transition: "background var(--dur) var(--ease)",
                }}
              >
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                  letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
                  color: current ? "var(--signal)" : "var(--scale)", flex: "none", width: 48,
                }}>{fmtSec(s.t)}</span>
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
                  color: "var(--scale)", flex: "none", width: 48,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{speakers?.[s.spk] ?? s.spk ?? ""}</span>
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
                  color: "var(--ink)", lineHeight: 1.7, textWrap: "pretty",
                }}>{s.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtSec(t) {
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
