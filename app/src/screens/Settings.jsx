// 设置 — 行式布局与「Podnote 正式设计 standalone.html」一致
// 设计修正落地:whisper 选项删除;LLM 模型真实化;key 密文;订阅 V2 占位
import { Button, Input, Lever } from "../components/core.jsx";
import { StatusLabel } from "../components/instrument.jsx";

function Row({ title, hint, children, last }) {
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

function Seg({ options, value, onChange }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flex: "none" }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange?.(o)}
            style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-medium)",
              letterSpacing: "var(--tracking-machine)", textTransform: "uppercase",
              background: on ? "var(--ink)" : "transparent",
              color: on ? "var(--panel)" : "var(--scale)",
              border: `1px solid ${on ? "var(--ink)" : "var(--line-soft)"}`,
              borderRadius: "var(--radius-sm)", padding: "4px 8px", cursor: "pointer",
              transition: "background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
            }}
          >{o}</button>
        );
      })}
    </span>
  );
}

export function Settings({ settings, onChange, onBack, onChooseDir }) {
  const s = settings;
  const set = (patch) => onChange?.({ ...s, ...patch });
  return (
    <div style={{
      flex: 1, minWidth: 0, overflow: "auto",
      display: "flex", justifyContent: "center", padding: "48px 0", boxSizing: "border-box",
    }}>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 16, height: "fit-content" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusLabel>SETTINGS</StatusLabel>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onBack}>BACK</Button>
        </div>
        <div style={{
          background: "var(--well)", borderRadius: "var(--radius)",
          padding: "8px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column",
        }}>
          <Row title="百炼 API Key" hint="转写服务密钥,只存在本机钥匙串">
            <Input
              type="password" value={s.asrKey}
              onChange={(e) => set({ asrKey: e.target.value })}
              style={{ width: 264 }} aria-label="百炼 API Key"
            />
          </Row>
          <Row title="LLM API Key" hint="笔记生成密钥,只存在本机钥匙串">
            <Input
              type="password" value={s.llmKey}
              onChange={(e) => set({ llmKey: e.target.value })}
              style={{ width: 264 }} aria-label="LLM API Key"
            />
          </Row>
          <Row title="笔记模型" hint="经你的 LLM 网关调用">
            <Seg options={["GROK-4.5", "CUSTOM"]} value={s.llmModelMode} onChange={(v) => set({ llmModelMode: v })} />
          </Row>
          {s.llmModelMode === "CUSTOM" && (
            <Row title="自定义模型" hint="模型 ID,按网关支持填写">
              <Input
                value={s.llmModelCustom}
                onChange={(e) => set({ llmModelCustom: e.target.value })}
                placeholder="model-id" style={{ width: 264 }} aria-label="自定义模型 ID"
              />
            </Row>
          )}
          <Row title="笔记输出目录" hint="每集一个 Markdown + JSON,可指向你的笔记库">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
                letterSpacing: "var(--tracking-machine)", color: "var(--ink)",
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{s.notesDir}</span>
              <Button variant="secondary" size="sm" onClick={onChooseDir}>CHOOSE</Button>
            </div>
          </Row>
          <Row
            title={<><span>订阅自动处理</span><StatusLabel tone="dim">V2</StatusLabel></>}
            hint="关注的节目更新后自动转写"
            last
          >
            <Lever on={false} disabled />
          </Row>
        </div>
      </div>
    </div>
  );
}
