// 设计系统·core 族 — 移植自「Podnote 正式设计 standalone.html」内嵌组件库
import { useState } from "react";

/** 按钮。knob = 橙色实体圆钮(仅"需要你启动"的场合);secondary = 凹槽平钮;ghost = 纯文字。 */
export function Button({ variant = "secondary", size = "md", children, style, ...rest }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const pad = { sm: "4px 12px", md: "8px 16px", lg: "12px 24px" }[size];
  const dia = { sm: 48, md: 64, lg: 88 }[size];
  const base = {
    fontFamily: "var(--font-mono)",
    fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-sm)",
    fontWeight: "var(--weight-medium)",
    letterSpacing: "var(--tracking-machine)",
    textTransform: "uppercase",
    cursor: "pointer",
    transition:
      "background var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease)",
    transform: down ? "translateY(1px)" : "none",
    userSelect: "none",
  };
  const variants = {
    knob: {
      width: dia, height: dia, borderRadius: "50%",
      background: "var(--signal)", color: "var(--panel)",
      border: "2px solid var(--ink)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      filter: hover ? "brightness(0.94)" : "none",
    },
    secondary: {
      padding: pad, borderRadius: "var(--radius)",
      background: hover ? "var(--fill-hover)" : "var(--well)",
      color: "var(--ink)", border: "1px solid var(--line-soft)",
    },
    ghost: {
      padding: pad, borderRadius: "var(--radius)",
      background: hover ? "var(--fill-hover)" : "transparent",
      color: "var(--scale)", border: "1px solid transparent",
    },
  };
  return (
    <button
      {...rest}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setDown(false); }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

/** 凹槽输入框。mono=true 用于机器内容(链接、API Key);sans 用于人写的内容。 */
export function Input({ mono = true, style, ...rest }) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      style={{
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: "var(--text-sm)",
        letterSpacing: mono ? "var(--tracking-machine)" : "normal",
        color: "var(--ink)",
        background: "var(--well)",
        border: focus ? "1px solid var(--ink)" : "1px solid var(--line-soft)",
        borderRadius: "var(--radius)",
        padding: "8px 12px",
        outline: "none",
        boxSizing: "border-box",
        transition: "border-color var(--dur) var(--ease)",
        ...style,
      }}
    />
  );
}

/** 拨杆开关。方形轨道 + 方形滑块,120ms 急停;不用 iOS 圆角开关。 */
export function Lever({ on = false, onChange, disabled = false, style }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!on)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 12,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: "none", border: "none", padding: 0,
        ...style,
      }}
    >
      <span style={{
        width: 44, height: 22, flex: "none", position: "relative",
        background: on ? "var(--fill-active)" : "var(--well)",
        border: on ? "1px solid var(--ink)" : "1px solid var(--line-soft)",
        borderRadius: "var(--radius-sm)", boxSizing: "border-box",
        transition: "border-color var(--dur) var(--ease), background var(--dur) var(--ease)",
      }}>
        <span style={{
          position: "absolute", top: 2, left: 2, width: 16, height: 16,
          background: "var(--ink)", borderRadius: 2,
          transform: on ? "translateX(22px)" : "none",
          transition: "transform var(--dur) var(--ease)",
        }} />
      </span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        letterSpacing: "var(--tracking-machine)", color: "var(--scale)",
        width: 28, textAlign: "left",
      }}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}
