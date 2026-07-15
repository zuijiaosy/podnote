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
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", animation: "pn-enter var(--dur-slow) var(--ease) both" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
          letterSpacing: "0.06em", color: "var(--scale)",
        }}>加载中…</span>
      </div>
    );
  }
  if (sentences.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", animation: "pn-enter var(--dur-slow) var(--ease) both" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)",
        }}>这期没有可用字幕,可以用右上角「重新转写」重跑一遍。</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column", animation: "pn-enter var(--dur-slow) var(--ease) both" }}>
      {!follow && (
        <button
          onClick={() => setFollow(true)}
          style={{
            position: "absolute", top: 8, right: 24, zIndex: 2,
            fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            background: "var(--ink)", color: "var(--paper)",
            border: "none", borderRadius: "var(--radius-round)",
            padding: "5px 14px", cursor: "pointer",
            boxShadow: "var(--shadow-pop)",
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
            const speakerChanged = i > 0 && s.spk !== sentences[i - 1].spk;
            return (
              <div
                key={i}
                ref={current ? currentRef : null}
                onClick={() => onSeekSec(s.t)}
                onMouseEnter={(e) => { if (!current) e.currentTarget.style.background = "var(--fill-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = current ? "var(--fill-hover)" : "transparent"; }}
                style={{
                  display: "grid", gridTemplateColumns: "48px 48px minmax(0, 1fr)", columnGap: 10,
                  alignItems: "baseline",
                  padding: "8px 12px 9px", borderRadius: "var(--radius-sm)",
                  marginTop: speakerChanged ? 10 : 0,
                  background: current ? "var(--fill-hover)" : "transparent",
                  // karaoke 降墨:播放位置之外的句子退后,当前句全墨;未开播(playSec=0)时全文全墨可读
                  opacity: playSec > 0 && currentIdx >= 0 && !current ? 0.7 : 1,
                  cursor: "pointer",
                  transition: "background var(--dur) var(--ease), opacity var(--dur-slow) var(--ease)",
                }}
              >
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                  letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
                  color: current ? "var(--signal)" : "var(--scale)", minWidth: 0,
                }}>{fmtSec(s.t)}</span>
                <span
                  title={speakers?.[s.spk] ?? s.spk ?? ""}
                  style={{
                    fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
                    color: "var(--scale)", minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{speakers?.[s.spk] ?? s.spk ?? ""}</span>
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
                  color: "var(--ink)", lineHeight: 1.7, textWrap: "pretty", minWidth: 0,
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
