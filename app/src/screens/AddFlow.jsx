// 添加流程弹层(焦点锁定):输入 / 处理中(五阶段灯) / 失败
// P0 为静态三幕;P2 接线后 stages 由 pipeline://progress 事件驱动
import { useState } from "react";
import { Button, Input } from "../components/core.jsx";
import { StatusLabel, IndicatorLight } from "../components/instrument.jsx";

export function AddFlow({ act = "input", stages = [], errMessage, url, onUrlChange, onStart, onClose, onEditUrl }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, background: "rgba(44,44,42,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, background: "var(--panel)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", padding: 24, boxSizing: "border-box",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusLabel>添加剧集{act === "run" ? " · 处理中" : ""}</StatusLabel>
          {act === "error" && <StatusLabel tone="signal">· 失败</StatusLabel>}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>

        {act === "input" && (
          <>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)" }}>
              粘贴小宇宙单集链接
            </div>
            <Input
              value={url}
              autoFocus
              onChange={(e) => onUrlChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onStart?.(); }}
              placeholder="https://www.xiaoyuzhoufm.com/episode/…"
              style={{ width: "100%" }}
              aria-label="小宇宙单集链接"
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16, marginTop: 8 }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
                letterSpacing: "var(--tracking-machine)", color: "var(--scale)",
              }}>链接直传云端转写</span>
              <Button variant="knob" size="md" onClick={onStart} aria-label="开始处理">开始</Button>
            </div>
          </>
        )}

        {act === "run" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
              {stages.map((st) => (
                <div key={st.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IndicatorLight status={st.status} label={st.label} />
                  <span style={{ flex: 1 }} />
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
                    letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
                    color: "var(--scale)",
                  }}>{st.meta || ""}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)" }}>
                音频链接直传云端转写,本地不留音频副本。
              </span>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" onClick={onClose}>后台处理</Button>
            </div>
          </>
        )}

        {act === "error" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
              <IndicatorLight status="error" label="处理失败" />
              <div style={{
                fontFamily: "var(--font-sans)", fontSize: "var(--text-base)",
                color: "var(--ink)", lineHeight: "var(--leading-note)",
              }}>{errMessage || "没能从这个链接里找到音频。检查它是不是完整的小宇宙单集链接,或者稍后重试。"}</div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                letterSpacing: "var(--tracking-machine)", color: "var(--scale)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{url}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={onEditUrl}>改链接</Button>
              <Button variant="secondary" size="sm" onClick={onStart}>重试</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** P0 演示用:自驱动的假五阶段(P2 换真实事件流) */
export function useDemoStages() {
  const [stages] = useState([
    { label: "RESOLVE", status: "ready", meta: "56:08 · 38.2 MB" },
    { label: "TRANSCRIBE", status: "processing", meta: "01:21 ELAPSED" },
    { label: "SUMMARIZE", status: "off", meta: "" },
    { label: "READY", status: "off", meta: "" },
  ]);
  return stages;
}
