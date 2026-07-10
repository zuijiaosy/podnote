// 设置 — 行式布局与「Podnote 正式设计 standalone.html」一致
// key 输入失焦即存钥匙串;已保存时占位提示,不回显密文
import { useState } from "react";
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

function KeyInput({ saved, onSave, label }) {
  const [val, setVal] = useState("");
  return (
    <Input
      type="password"
      value={val}
      placeholder={saved ? "已保存 · 输入以更换" : "sk-…"}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (val.trim()) { onSave(val.trim()); setVal(""); } }}
      style={{ width: 264 }}
      aria-label={label}
    />
  );
}

/** 文本配置项:失焦即存;清空回落默认值 */
function TextField({ value, fallback, onSave, label, width = 264 }) {
  return (
    <Input
      key={value}
      defaultValue={value}
      placeholder={fallback}
      onBlur={(e) => {
        const v = e.target.value.trim() || fallback;
        if (v !== value) onSave(v);
      }}
      style={{ width }}
      aria-label={label}
    />
  );
}

const DEFAULTS = {
  asrHost: "https://llm-xy8sn8964kplkx1s.cn-beijing.maas.aliyuncs.com",
  llmBaseUrl: "https://api.codexzh.com/v1",
  llmModel: "grok-4.5",
};

export function Settings({ view, onChangeField, onSaveKeys, onChooseDir, onBack }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, overflow: "auto",
      display: "flex", justifyContent: "center", padding: "48px 0", boxSizing: "border-box",
    }}>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 16, height: "fit-content" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusLabel>设置</StatusLabel>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onBack}>返回</Button>
        </div>
        <div style={{
          background: "var(--well)", borderRadius: "var(--radius)",
          padding: "8px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column",
        }}>
          <Row title={<><span>百炼 API Key</span><StatusLabel tone={view.asrKeySet ? "ready" : "dim"}>{view.asrKeySet ? "已保存" : "未设置"}</StatusLabel></>}
            hint="转写服务密钥,只存在本机钥匙串">
            <KeyInput saved={view.asrKeySet} label="百炼 API Key" onSave={(v) => onSaveKeys({ asrKey: v })} />
          </Row>
          <Row title="百炼 API 地址" hint="转写服务网关,清空恢复默认">
            <TextField value={view.asrHost} fallback={DEFAULTS.asrHost}
              onSave={(v) => onChangeField({ asrHost: v })} label="百炼 API 地址" />
          </Row>
          <Row title={<><span>LLM API Key</span><StatusLabel tone={view.llmKeySet ? "ready" : "dim"}>{view.llmKeySet ? "已保存" : "未设置"}</StatusLabel></>}
            hint="笔记生成密钥,只存在本机钥匙串">
            <KeyInput saved={view.llmKeySet} label="LLM API Key" onSave={(v) => onSaveKeys({ llmKey: v })} />
          </Row>
          <Row title="LLM 网关地址" hint="OpenAI Responses 协议,清空恢复默认">
            <TextField value={view.llmBaseUrl} fallback={DEFAULTS.llmBaseUrl}
              onSave={(v) => onChangeField({ llmBaseUrl: v })} label="LLM 网关地址" />
          </Row>
          <Row title="笔记模型" hint="模型 ID,按网关支持填写,清空恢复默认">
            <TextField value={view.llmModel} fallback={DEFAULTS.llmModel}
              onSave={(v) => onChangeField({ llmModel: v })} label="笔记模型" width={200} />
          </Row>
          <Row title="笔记导出目录" hint="额外导出一份 Markdown 到你的笔记库(可选)">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
                letterSpacing: "var(--tracking-machine)", color: view.notesDir ? "var(--ink)" : "var(--scale)",
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl",
              }}>{view.notesDir || "未设置"}</span>
              <Button variant="secondary" size="sm" onClick={onChooseDir}>选择</Button>
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
