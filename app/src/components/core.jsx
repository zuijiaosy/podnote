// 设计系统·core 族 — 宪法 v4「双皮肤仪器」
// 物理语言:按键有键程(shadow-key/键按下沉),输入是凹槽(shadow-well),
// 主动作 = accent 实底;所有形态差异(方键 vs 胶囊)由皮肤 token 决定,组件不感知皮肤。
import { useEffect, useRef, useState } from "react";

/** 按钮。knob = accent 实底(仅"需要你启动/花钱"的场合);secondary = 实体按键;ghost = 纯文字。 */
export function Button({ variant = "secondary", size = "md", children, style, ...rest }) {
  const [hover, setHover] = useState(false);
  const pad = { sm: "5px 12px", md: "8px 16px", lg: "12px 26px" }[size];
  const base = {
    fontFamily: "var(--font-ui)",
    fontSize: size === "lg" ? "var(--text-base)" : "var(--text-sm)",
    fontWeight: "var(--weight-medium)",
    lineHeight: "var(--leading-tight)",
    padding: pad,
    borderRadius: "var(--radius-ctl)",
    cursor: "pointer",
    userSelect: "none",
    transition: "background var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
  };
  const variants = {
    knob: {
      background: "var(--accent)", color: "var(--on-accent)",
      border: "1px solid transparent",
      boxShadow: "var(--shadow-key)",
      filter: hover ? "brightness(1.08)" : "none",
    },
    secondary: {
      background: hover ? "var(--surface-hover)" : "var(--surface-2)",
      color: "var(--txt)",
      border: "1px solid var(--border-unit)",
      boxShadow: "var(--shadow-key)",
    },
    // ghost 也要一眼认得出是按钮:静息带一层浅底,不再是裸文字
    ghost: {
      background: hover ? "var(--fill-active)" : "var(--fill-hover)",
      color: hover ? "var(--txt)" : "var(--dim)",
      border: "1px solid transparent",
    },
  };
  return (
    <button
      {...rest}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

/** 分段选择:选项互斥。仪器语言 = 凹槽轨道 + 浮起的选中键(磁带机方键/玻璃胶囊由 token 决定)。 */
export function Segmented({ options, value, onChange, style }) {
  const cell = (active) => ({
    flex: 1,
    padding: "4px 12px 5px",
    textAlign: "center",
    fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
    fontWeight: active ? "var(--weight-medium)" : "var(--weight-regular)",
    fontVariantNumeric: "tabular-nums",
    cursor: active ? "default" : "pointer", userSelect: "none",
    background: active ? "var(--surface-2)" : "transparent",
    color: active ? "var(--txt)" : "var(--dim)",
    border: "none",
    borderRadius: "var(--radius-ctl)",
    boxShadow: active ? "var(--shadow-key)" : "none",
    whiteSpace: "nowrap",
    transition: "color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
  });
  return (
    <div style={{
      display: "flex", gap: 2, padding: 3, boxSizing: "border-box",
      background: "var(--surface-well)",
      borderRadius: "calc(var(--radius-ctl) + 3px)",
      boxShadow: "var(--shadow-well)",
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

/** 输入凹槽:面板上凹进去的一道槽。mono=true 用于机器内容(链接、API Key);sans 用于人写的内容。 */
export function Input({ mono = true, style, ...rest }) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      style={{
        fontFamily: mono ? "var(--font-data)" : "var(--font-ui)",
        fontSize: "var(--text-sm)",
        letterSpacing: mono ? "var(--tracking-machine)" : "normal",
        color: "var(--txt)",
        background: "var(--surface-well)",
        border: focus ? "1px solid var(--accent)" : "1px solid transparent",
        borderRadius: "var(--radius-field)",
        boxShadow: "var(--shadow-well)",
        padding: "7px 12px",
        outline: "none",
        boxSizing: "border-box",
        transition: "border-color var(--dur) var(--ease)",
        ...style,
      }}
    />
  );
}

/** 配置行:左侧标题+说明,右侧控件,行间发丝线;设置与订阅两屏共用。 */
export function FieldRow({ title, hint, children, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 24, padding: "17px 0 18px",
      borderBottom: last ? "none" : "1px solid var(--line-faint)",
    }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontFamily: "var(--font-ui)", fontSize: "var(--text-base)",
          fontWeight: "var(--weight-medium)", color: "var(--txt)",
          display: "flex", alignItems: "center", gap: 8,
        }}>{title}</span>
        {hint && (
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--dim)", lineHeight: 1.5 }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** 下拉。有限枚举用它,不给自由文本留拼错的空间;当前值不在选项里时原样保留。
    触发器 = 输入凹槽同语言;面板 = 卡片浮起(shadow-pop,全 App 仅浮层可用的最大阴影)。 */
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
          fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
          color: "var(--txt)",
          background: "var(--surface-well)",
          border: open ? "1px solid var(--accent)" : "1px solid transparent",
          borderRadius: "var(--radius-field)",
          boxShadow: "var(--shadow-well)",
          padding: "7px 12px", boxSizing: "border-box", cursor: "pointer",
          transition: "border-color var(--dur) var(--ease)",
        }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {items.find((o) => o.value === value)?.label ?? value}
        </span>
        <span style={{
          flex: "none", fontFamily: "var(--font-data)", fontSize: "var(--text-xs)",
          color: "var(--dim)", transform: open ? "rotate(180deg)" : "none",
          transition: "transform var(--dur) var(--ease)", lineHeight: 1,
        }}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 3,
            background: "var(--surface-2)", border: "1px solid var(--border-unit)",
            boxShadow: "var(--shadow-pop)",
            backdropFilter: "blur(var(--blur)) saturate(1.6)",
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
                  fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
                  fontWeight: active ? "var(--weight-medium)" : "var(--weight-regular)",
                  color: active ? "var(--txt)" : "var(--dim)",
                  textAlign: "left", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                  background: active ? "var(--fill-active)" : hi === i ? "var(--fill-hover)" : "transparent",
                  border: "none",
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

/** 多选框。凹槽方框,选中 = accent 实心块;块级多选核查用。 */
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
        background: "var(--surface-well)",
        border: checked || hover ? "1px solid var(--accent)" : "1px solid transparent",
        boxShadow: "var(--shadow-well)",
        borderRadius: "var(--radius-sm)", boxSizing: "border-box", cursor: "pointer",
        transition: "border-color var(--dur) var(--ease)",
        ...style,
      }}
    >
      {checked && (
        <span style={{
          position: "absolute", inset: 4, background: "var(--accent)", borderRadius: 2,
          animation: "pn-pop var(--dur) var(--ease) both",
        }} />
      )}
    </button>
  );
}

/** 开关。凹槽轨道,开 = accent 实底 + 白色圆钮;120ms 急停。 */
export function Lever({ on = false, onChange, disabled = false, style }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!on)}
      style={{
        display: "inline-flex", alignItems: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: "none", border: "none", padding: 0,
        ...style,
      }}
    >
      <span style={{
        width: 38, height: 20, flex: "none", position: "relative",
        background: on ? "var(--accent)" : "var(--surface-well)",
        boxShadow: on ? "var(--shadow-key)" : "var(--shadow-well)",
        border: "none",
        borderRadius: 999, boxSizing: "border-box",
        transition: "background var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
      }}>
        <span style={{
          position: "absolute", top: 3, left: 3, width: 14, height: 14,
          background: on ? "var(--on-accent)" : "var(--dim)",
          borderRadius: 999,
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          transform: on ? "translateX(18px)" : "none",
          transition: "transform var(--dur) var(--ease), background var(--dur) var(--ease)",
        }} />
      </span>
    </button>
  );
}
