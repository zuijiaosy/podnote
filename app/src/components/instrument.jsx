// 设计系统·instrument 族 — 宪法 v4「双皮肤仪器」
// 指示灯四态与波形是历代保留的产品之魂;时间戳是可按的机读芯片,列表项是一盘磁带卡片
import { useEffect, useRef, useState } from "react";

/** 栏目眉:小号无衬线标签,宽字距;tone 控制墨色。 */
export function StatusLabel({ children, tone = "default", size = "sm", style }) {
  const color = {
    default: "var(--ink)", dim: "var(--scale)",
    signal: "var(--signal)", ready: "var(--ready)",
  }[tone];
  return (
    <span style={{
      fontFamily: "var(--font-sans)",
      fontSize: size === "sm" ? "var(--text-sm)" : "var(--text-xs)",
      fontWeight: "var(--weight-medium)",
      letterSpacing: "0.06em",
      fontVariantNumeric: "tabular-nums",
      color, ...style,
    }}>{children}</span>
  );
}

/** 指示灯四态:灰=待命 / 墨呼吸=运转中 / 绿常亮=完成 / 朱红常亮(不呼吸)=需要人。 */
export function IndicatorLight({ status = "off", label, style }) {
  const colors = {
    off: "var(--status-idle)",
    processing: "var(--status-processing)",
    ready: "var(--status-ready)",
    error: "var(--status-error)",
  };
  // 挂载后状态翻到 ready 时"咔哒"一跳(初始就是 ready 不跳,避免开机满架绿灯乱蹦)
  const prev = useRef(status);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (prev.current !== status && status === "ready") setPop(true);
    prev.current = status;
  }, [status]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      <span
        onAnimationEnd={() => setPop(false)}
        style={{
          width: 7, height: 7, flex: "none", borderRadius: "var(--radius-round)",
          background: colors[status],
          opacity: status === "off" ? 0.5 : 1,
          transition: "background var(--dur) var(--ease)",
          animation: status === "processing" ? "pn-breathe 2s linear infinite"
            : pop ? "pn-pop var(--dur-slow) var(--ease)" : "none",
        }} />
      {label && (
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          fontVariantNumeric: "tabular-nums",
          color: status === "error" ? "var(--signal)"
            : status === "off" ? "var(--scale)" : "var(--ink)",
        }}>{label}</span>
      )}
    </span>
  );
}

/** 时间戳 = 可按的机读小芯片。凹槽底 + 等宽数字;悬停/激活转 accent;点击闪现一次=指令已执行。 */
export function Timestamp({ time, active = false, onSeek, style }) {
  const [hover, setHover] = useState(false);
  const [flash, setFlash] = useState(false);
  return (
    <button
      onClick={(e) => { setFlash(true); onSeek?.(e); }}
      onAnimationEnd={() => setFlash(false)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        animation: flash ? "pn-flash var(--dur-slow) var(--ease)" : "none",
        fontFamily: "var(--font-data)", fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
        color: active ? "var(--on-accent)" : hover ? "var(--accent)" : "var(--dim)",
        background: active ? "var(--accent)" : "var(--surface-well)",
        border: "none",
        borderRadius: "var(--radius-chip)",
        boxShadow: active ? "var(--shadow-key)" : "var(--shadow-well)",
        padding: "2px 7px", cursor: "pointer", flex: "none",
        transition: "color var(--dur) var(--ease), background var(--dur) var(--ease)",
        ...style,
      }}
    >{time}</button>
  );
}

/** 剧集列表项 = 一盘磁带/一块卡片。选中态由皮肤决定:磁带机左缘 accent 墨条,玻璃 accent 描边圈。 */
export function EpisodeItem({
  date, show, title, duration, status = "ready", statusLabel,
  active = false, errReason, onClick, onContextMenu, style,
}) {
  const [hover, setHover] = useState(false);
  const defaultLabel = { off: "排队中", processing: "运行中", ready: "就绪", error: "出错" }[status];
  return (
    <div
      role="button" tabIndex={0}
      className={`pn-card${active ? " pn-item-active" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        ...(hover && !active ? { background: "var(--surface-hover)" } : null),
        padding: "11px 13px", cursor: "pointer", boxSizing: "border-box",
        transition: "background var(--dur) var(--ease)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-medium)",
          color: active ? "var(--accent)" : "var(--dim)",
          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          transition: "color var(--dur) var(--ease)",
        }}>{show}</span>
        <span style={{
          fontFamily: "var(--font-data)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
          color: "var(--faint)", flex: "none",
        }}>{date}</span>
      </div>
      <div style={{
        fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
        fontWeight: active ? "var(--weight-medium)" : "var(--weight-regular)",
        color: "var(--txt)",
        lineHeight: 1.45, margin: "5px 0 4px",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>{title}</div>
      {status === "error" && errReason && (
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)",
          lineHeight: "var(--leading-tight)", marginBottom: 4,
        }}>{errReason}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <IndicatorLight status={status} label={statusLabel || defaultLabel} style={{ minWidth: 0 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
          color: "var(--scale)", flex: "none", whiteSpace: "nowrap",
        }}>{duration}</span>
      </div>
    </div>
  );
}

/** 波形刻度条 = 真进度条。已播=油墨,未播=铅灰,笔记锚点=朱红(只上核心观点)。
    bars 必须是真实峰值(Web Audio 解码);没有就诚实地画均匀低矮刻度,
    真峰值到位时逐条生长成型(transition-delay 从左到右扫过,像仪器校准)。 */
export function Waveform({ bars, progress = 0, anchors = [], height = 40, onSeek, style }) {
  const pending = !(bars && bars.length);
  const data = pending ? PENDING_BARS : bars;
  const n = data.length;
  // 唯一的朱红锚点 = 播放位置所在章节;其余锚点退为墨色刻度(强调色不许当装饰用)
  const activeAnchor = anchors.reduce((acc, a) => (a <= progress && a > acc ? a : acc), -1);
  return (
    <div
      onClick={(e) => {
        if (!onSeek) return;
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? "播放进度" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 2, height, cursor: onSeek ? "pointer" : "default", ...style }}
    >
      {data.map((v, i) => {
        const frac = i / n;
        const anchorAt = anchors.find((a) => Math.abs(a - frac) < 0.5 / n);
        const isAnchor = anchorAt !== undefined;
        const isActiveAnchor = isAnchor && activeAnchor >= 0 && Math.abs(anchorAt - activeAnchor) < 0.5 / n;
        const played = frac <= progress;
        return (
          <span key={i} style={{
            flex: 1, minWidth: 1, maxWidth: isAnchor ? 2 : 3,
            /* 锚点刻度:只有当前章节的锚点用朱红,其余是墨色小刻度 */
            height: isAnchor ? "38%" : pending ? "12%" : `${Math.round(v * 70)}%`,
            background: isActiveAnchor ? "var(--signal)" : isAnchor ? "var(--ink)" : played ? "var(--ink)" : "var(--scale)",
            opacity: isActiveAnchor ? 1 : isAnchor ? 0.4 : played ? 1 : pending ? 0.3 : 0.45,
            borderRadius: 1,
            /* 生长只延迟 height:进度颜色翻转不跟着拖泥带水 */
            transition: `height var(--dur-slow) var(--ease) ${i * 3}ms, background var(--dur) var(--ease), opacity var(--dur) var(--ease)`,
          }} />
        );
      })}
    </div>
  );
}
/** 峰值未就绪时的占位:均匀低矮刻度,一眼可辨"还没有数据" */
const PENDING_BARS = new Array(110).fill(0);
