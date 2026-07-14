// 设计系统·core 族 — 移植自「Podnote 正式设计 standalone.html」内嵌组件库
import { useEffect, useRef, useState } from "react";

/** 按钮。knob = 橙色实体圆钮(仅"需要你启动"的场合);secondary = 凹槽平钮;ghost = 纯文字。 */
export function Button({ variant = "secondary", size = "md", children, style, ...rest }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const pad = { sm: "6px 12px", md: "9px 16px", lg: "13px 24px" }[size];
  const dia = { sm: 48, md: 64, lg: 88 }[size];
  const base = {
    fontFamily: "var(--font-mono)",
    /* 按钮文字统一 sm(13px):中文在 xs 档不可读;尺寸差异交给内边距 */
    fontSize: "var(--text-sm)",
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
      color: hover ? "var(--ink)" : "var(--scale)",
      // 可见边框:纯文字按钮与静态标签必须能一眼区分
      border: "1px solid var(--line-soft)",
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

/** 分段选择:选项互斥,选中项 fill-active + ink 描边(与磁带架视图切换同语言) */
export function Segmented({ options, value, onChange, style }) {
  const cell = (active) => ({
    flex: 1, padding: "5px 8px", textAlign: "center",
    fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
    letterSpacing: "var(--tracking-machine)",
    cursor: active ? "default" : "pointer", userSelect: "none",
    background: active ? "var(--fill-active)" : "transparent",
    color: active ? "var(--ink)" : "var(--scale)",
    border: active ? "1px solid var(--ink)" : "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    whiteSpace: "nowrap",
    transition: "background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
  });
  return (
    <div style={{
      display: "flex", gap: 4, padding: 3,
      background: "var(--panel)", border: "1px solid var(--line-soft)",
      borderRadius: "var(--radius)", boxSizing: "border-box",
      ...style,
    }}>
      {options.map((o) => (
        <button key={o.value} style={cell(o.value === value)}
          onClick={() => o.value !== value && onChange?.(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
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

/** 配置行:左侧标题+说明,右侧控件,行间细分隔线;设置与订阅两屏共用。 */
export function FieldRow({ title, hint, children, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 24, padding: "16px 0",
      borderBottom: last ? "none" : "1px solid var(--line-faint)",
    }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
          fontWeight: "var(--weight-medium)", color: "var(--ink)",
          display: "flex", alignItems: "center", gap: 8,
        }}>{title}</span>
        {hint && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** 凹槽下拉。有限枚举用它,不给自由文本留拼错的空间;当前值不在选项里时原样保留。
    自绘触发器与面板:原生 select 的系统弹出菜单会打破仪器语言。
    面板材质与 NoteView 右键菜单同源(panel 底 + line-soft 边,无阴影),
    选中行 = fill-active + ink 描边,与 Segmented 选中态同语言。 */
export function Select({ options, value, onChange, style }) {
  const items = options.some((o) => o.value === value) || !value
    ? options
    : [{ value, label: value }, ...options];
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // 键盘高亮位;-1 = 未用键盘
  const rootRef = useRef(null);

  // 点外关闭(mousedown 即收,与右键菜单同手感)
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (v) => {
    setOpen(false);
    if (v !== value) onChange?.(v);
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setHi(items.findIndex((o) => o.value === value)); return; }
      const d = e.key === "ArrowDown" ? 1 : -1;
      setHi((h) => (h + d + items.length) % items.length);
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && open && hi >= 0) {
      e.preventDefault();
      pick(items[hi].value);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative", boxSizing: "border-box", ...style }}>
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(!open); setHi(-1); }}
        onKeyDown={onKeyDown}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
          color: "var(--ink)",
          background: "var(--well)",
          border: open ? "1px solid var(--ink)" : "1px solid var(--line-soft)",
          borderRadius: "var(--radius)",
          padding: "8px 12px", boxSizing: "border-box", cursor: "pointer",
          transition: "border-color var(--dur) var(--ease)",
        }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {items.find((o) => o.value === value)?.label ?? value}
        </span>
        <span style={{
          flex: "none", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          color: "var(--scale)", transform: open ? "rotate(180deg)" : "none",
          transition: "transform var(--dur) var(--ease)", lineHeight: 1,
        }}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 3,
            background: "var(--panel)", border: "1px solid var(--line-soft)",
            borderRadius: "var(--radius)", padding: 4, boxSizing: "border-box",
            display: "flex", flexDirection: "column", gap: 2,
            animation: "pn-enter var(--dur) var(--ease) both",
          }}
        >
          {items.map((o, i) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                role="option"
                aria-selected={active}
                onClick={() => pick(o.value)}
                onMouseEnter={(e) => { if (!active && hi !== i) e.currentTarget.style.background = "var(--fill-hover)"; }}
                onMouseLeave={(e) => { if (!active && hi !== i) e.currentTarget.style.background = "transparent"; }}
                style={{
                  fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
                  color: active ? "var(--ink)" : "var(--scale)",
                  textAlign: "left", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                  background: active ? "var(--fill-active)" : hi === i ? "var(--fill-hover)" : "transparent",
                  border: active ? "1px solid var(--ink)" : "1px solid transparent",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 10px", cursor: active ? "default" : "pointer",
                }}
              >{o.label}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 多选框。方形凹槽 + ink 实心方块,与 Lever 同语言;块级多选核查用。 */
export function Checkbox({ checked = false, onChange, style }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 18, height: 18, padding: 0, flex: "none", position: "relative",
        background: checked ? "var(--fill-active)" : "var(--well)",
        border: checked || hover ? "1px solid var(--ink)" : "1px solid var(--line-soft)",
        borderRadius: "var(--radius-sm)", boxSizing: "border-box", cursor: "pointer",
        transition: "border-color var(--dur) var(--ease), background var(--dur) var(--ease)",
        ...style,
      }}
    >
      {checked && (
        <span style={{
          position: "absolute", inset: 4, background: "var(--ink)", borderRadius: 1,
          animation: "pn-pop var(--dur) var(--ease) both",
        }} />
      )}
    </button>
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
