// 设计系统·instrument 族 — 移植自「Podnote 正式设计 standalone.html」内嵌组件库
import { useEffect, useRef, useState } from "react";

/** 丝印状态词。tone 控制墨色;中文标签最低 12px(sm),纯 ASCII 丝印可用 xs。 */
export function StatusLabel({ children, tone = "default", size = "sm", style }) {
  const color = {
    default: "var(--ink)", dim: "var(--scale)",
    signal: "var(--signal)", ready: "var(--ready)",
  }[tone];
  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontSize: size === "sm" ? "var(--text-sm)" : "var(--text-xs)",
      fontWeight: "var(--weight-medium)",
      letterSpacing: "var(--tracking-machine-wide)",
      textTransform: "uppercase",
      fontVariantNumeric: "tabular-nums",
      color, ...style,
    }}>{children}</span>
  );
}

/** 仪器指示灯四态:灰=待命 / 炭呼吸=运转中 / 绿常亮=完成 / 橙常亮(不呼吸)=需要人。 */
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
          width: 8, height: 8, flex: "none", borderRadius: "var(--radius-round)",
          background: colors[status],
          opacity: status === "off" ? 0.5 : 1,
          transition: "background var(--dur) var(--ease)",
          animation: status === "processing" ? "pn-breathe 2s linear infinite"
            : pop ? "pn-pop var(--dur-slow) var(--ease)" : "none",
        }} />
      {label && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          letterSpacing: "var(--tracking-machine)", textTransform: "uppercase",
          fontVariantNumeric: "tabular-nums",
          color: status === "error" ? "var(--signal)"
            : status === "off" ? "var(--scale)" : "var(--ink)",
        }}>{label}</span>
      )}
    </span>
  );
}

/** 时间戳 = 磁带计数器。等宽数字胶囊,点击回跳,激活态信号橙。 */
export function Timestamp({ time, active = false, onSeek, style }) {
  const [hover, setHover] = useState(false);
  const [flash, setFlash] = useState(false); // 点击后闪现一次:指令已执行
  return (
    <button
      onClick={(e) => { setFlash(true); onSeek?.(e); }}
      onAnimationEnd={() => setFlash(false)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        animation: flash ? "pn-flash var(--dur-slow) var(--ease)" : "none",
        fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-regular)",
        letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
        color: active ? "var(--signal)" : hover ? "var(--ink)" : "var(--scale)",
        background: "transparent",
        border: active ? "1px solid var(--signal)" : "1px solid var(--line-soft)",
        borderRadius: "var(--radius-round)",
        padding: "1px 10px 2px", cursor: "pointer",
        transition: "color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
        ...style,
      }}
    >{time}</button>
  );
}

/** 剧集列表项 = 磁带盒。节目名无衬线(中文禁入等宽),日期等宽,状态灯 + 时长/耗时。 */
export function EpisodeItem({
  date, show, title, duration, status = "ready", statusLabel,
  active = false, errReason, onClick, onContextMenu, style,
}) {
  const [hover, setHover] = useState(false);
  const defaultLabel = { off: "排队中", processing: "运行中", ready: "就绪", error: "出错" }[status];
  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active ? "var(--fill-active)" : hover ? "var(--fill-hover)" : "var(--well)",
        border: active ? "1px solid var(--ink)" : "1px solid var(--line-soft)",
        borderRadius: "var(--radius)",
        padding: "8px 12px", cursor: "pointer", boxSizing: "border-box",
        transition: "border-color var(--dur) var(--ease), background var(--dur) var(--ease)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)",
          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{show}</span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
          color: "var(--scale)", flex: "none",
        }}>{date}</span>
      </div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
        fontWeight: "var(--weight-medium)", color: "var(--ink)",
        lineHeight: "var(--leading-tight)", margin: "4px 0",
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

/** 波形刻度条 = 真进度条。已播=丝印炭,未播=刻度灰,笔记锚点=信号橙(只上核心观点)。
    bars 必须是真实峰值(Web Audio 解码);没有就诚实地画均匀低矮刻度,
    真峰值到位时逐条生长成型(transition-delay 从左到右扫过,像仪器校准)。 */
export function Waveform({ bars, progress = 0, anchors = [], height = 40, onSeek, style }) {
  const pending = !(bars && bars.length);
  const data = pending ? PENDING_BARS : bars;
  const n = data.length;
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
        const isAnchor = anchors.some((a) => Math.abs(a - frac) < 0.5 / n);
        const played = frac <= progress;
        return (
          <span key={i} style={{
            flex: 1, minWidth: 1, maxWidth: isAnchor ? 2 : 3,
            /* 锚点=橙色刻度:半高降噪(真实笔记 10+ 锚点时全高会变圣诞树) */
            height: isAnchor ? "55%" : pending ? "12%" : `${Math.round(v * 70)}%`,
            background: isAnchor ? "var(--signal)" : played ? "var(--ink)" : "var(--scale)",
            opacity: isAnchor || played ? 1 : pending ? 0.35 : 0.5,
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
