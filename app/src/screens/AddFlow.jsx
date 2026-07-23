// 添加流程弹层(焦点锁定):输入(链接 | 本地录音) / 处理中(五阶段灯) / 失败
// P0 为静态三幕;P2 接线后 stages 由 pipeline://progress 事件驱动
import { useState } from "react";
import { Button, Input, Segmented } from "../components/core.jsx";
import { StatusLabel, IndicatorLight } from "../components/instrument.jsx";

const fmtSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function AddFlow({
  act = "input", stages = [], errMessage, url, onUrlChange, onStart, onClose, onEditUrl,
  source = "url", onSourceChange,
  file, onPickFile, title, onTitleChange, context, onContextChange,
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, background: "rgba(33,30,25,0.22)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10,
        animation: "pn-fade var(--dur) var(--ease) both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, background: "var(--paper)", border: "1px solid var(--line-faint)",
          boxShadow: "var(--shadow-pop)",
          borderRadius: "var(--radius)", padding: 24, boxSizing: "border-box",
          display: "flex", flexDirection: "column", gap: 16,
          animation: "pn-enter var(--dur-slow) var(--ease) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{
            fontFamily: "var(--font-serif)", fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-display)", letterSpacing: "var(--tracking-display)",
            color: "var(--ink)",
          }}>{source === "file" ? "添加录音" : "添加剧集"}</span>
          {act === "error" && <StatusLabel tone="signal">失败</StatusLabel>}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onClose} style={{ alignSelf: "center" }}>关闭</Button>
        </div>

        {act === "input" && (
          <>
            {onSourceChange && (
              <Segmented
                value={source}
                onChange={onSourceChange}
                options={[
                  { value: "url", label: "小宇宙链接" },
                  { value: "file", label: "本地录音" },
                ]}
              />
            )}

            {source === "url" && (
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
                    fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)",
                  }}>链接直传云端转写</span>
                  <Button variant="knob" size="md" onClick={onStart} aria-label="开始处理">开始</Button>
                </div>
              </>
            )}

            {source === "file" && !file && (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={onPickFile}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPickFile?.(); } }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                    padding: "28px 16px", cursor: "pointer",
                    background: "var(--surface-well)", borderRadius: "var(--radius-field)",
                    boxShadow: "var(--shadow-well)",
                  }}
                  aria-label="选择音频文件"
                >
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--txt)" }}>
                    把录音文件拖进窗口,或点击选择
                  </span>
                  <span style={{
                    fontFamily: "var(--font-data)", fontSize: "var(--text-xs)",
                    letterSpacing: "var(--tracking-machine)", color: "var(--faint)",
                  }}>m4a · mp3 · wav · aac · flac · ogg · opus</span>
                </div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--dim)", lineHeight: 1.6 }}>
                  会议、访谈、语音备忘录都可以。录音只上传到你自己的百炼账号用于转写,48 小时后云端自动删除。
                </div>
              </>
            )}

            {source === "file" && file && (
              <>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 10, minWidth: 0,
                  padding: "9px 12px", background: "var(--surface-well)",
                  borderRadius: "var(--radius-field)", boxShadow: "var(--shadow-well)",
                }}>
                  <span style={{
                    fontFamily: "var(--font-data)", fontSize: "var(--text-sm)",
                    letterSpacing: "var(--tracking-machine)", color: "var(--txt)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                  }} title={file.fileName}>{file.fileName}</span>
                  <span style={{
                    fontFamily: "var(--font-data)", fontSize: "var(--text-xs)",
                    letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
                    color: "var(--dim)", flex: "none",
                  }}>{fmtSize(file.sizeBytes)}</span>
                  <Button variant="ghost" size="sm" onClick={onPickFile} style={{ flex: "none" }}>换一个</Button>
                </div>
                <Input
                  mono={false}
                  value={title}
                  autoFocus
                  onChange={(e) => onTitleChange?.(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onStart?.(); }}
                  placeholder="标题(默认用文件名)"
                  style={{ width: "100%" }}
                  aria-label="录音标题"
                />
                <AddTextarea
                  value={context}
                  onChange={onContextChange}
                  placeholder="背景信息(可选):议程、参会人名单、项目名、专有名词……写了能显著提高人名与术语的转写准确率"
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                  <span style={{
                    fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--dim)",
                    lineHeight: 1.5, maxWidth: 260,
                  }}>转写按录音时长计费;只上传到你自己的百炼账号,48 小时后云端自动删除</span>
                  <span style={{ flex: 1 }} />
                  <Button variant="knob" size="md" onClick={onStart} aria-label="开始处理">开始</Button>
                </div>
              </>
            )}
          </>
        )}

        {act === "run" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 8px" }}>
              {stages.map((st) => (
                <div key={st.label} style={{
                  display: "grid", gridTemplateColumns: "1fr 160px", columnGap: 12, alignItems: "center",
                }}>
                  <IndicatorLight status={st.status} label={st.label} />
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                    letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
                    color: "var(--scale)", textAlign: "right",
                  }}>{st.meta || ""}</span>
                </div>
              ))}
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              borderTop: "1px solid var(--line-faint)", paddingTop: 14,
            }}>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)",
                lineHeight: 1.5, maxWidth: 280,
              }}>
                {source === "file"
                  ? "录音上传到你自己的百炼账号转写,48 小时后云端自动删除;本地副本已存入资料库。"
                  : "音频链接直传云端转写,本地不留音频副本。"}
              </span>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" onClick={onClose} style={{ flex: "none" }}>后台处理</Button>
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
              }}>{errMessage || (source === "file"
                ? "没能处理这个录音文件。检查它是不是完整的音频文件,或者稍后重试。"
                : "没能从这个链接里找到音频。检查它是不是完整的小宇宙单集链接,或者稍后重试。")}</div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                letterSpacing: "var(--tracking-machine)", color: "var(--scale)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{source === "file" ? file?.fileName ?? "" : url}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={onEditUrl}>{source === "file" ? "返回修改" : "改链接"}</Button>
              <Button variant="secondary" size="sm" onClick={onStart}>重试</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 多行输入凹槽:与 core.jsx 的 Input 同一套槽样式(背景信息是人写的内容,用 --font-ui) */
function AddTextarea({ value, onChange, placeholder }) {
  const [focus, setFocus] = useState(false);
  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      placeholder={placeholder}
      rows={3}
      style={{
        fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
        color: "var(--txt)", lineHeight: 1.6,
        background: "var(--surface-well)",
        border: focus ? "1px solid var(--accent)" : "1px solid transparent",
        borderRadius: "var(--radius-field)",
        boxShadow: "var(--shadow-well)",
        padding: "7px 12px", outline: "none", boxSizing: "border-box",
        width: "100%", resize: "vertical", minHeight: 68,
        transition: "border-color var(--dur) var(--ease)",
      }}
      aria-label="背景信息"
    />
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
