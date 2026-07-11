// 设置 — 行式布局与「Podnote 正式设计 standalone.html」一致
// key 输入失焦即存钥匙串;已保存时占位提示,不回显密文
import { useState } from "react";
import { Button, Input, Lever, Segmented } from "../components/core.jsx";
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
  llmApi: "openai-responses",
  llmModel: "grok-4.5",
  ttsVoice: "Cherry",
};

const LLM_PROTOCOLS = [
  { value: "openai-responses", label: "Responses" },
  { value: "openai-completions", label: "Chat" },
  { value: "anthropic-messages", label: "Claude" },
];

/** 订阅管理:节目列表 + 添加(节目/单集链接均可)+ 立即检查 */
function Subscriptions({ subs, onAdd, onRemove, onCheck }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");

  const add = async () => {
    const v = url.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onAdd(v);
      setUrl("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    if (checking) return;
    setChecking(true);
    setCheckMsg("");
    try {
      const n = await onCheck();
      setCheckMsg(n > 0 ? `发现 ${n} 集新单集,已自动处理` : "没有新单集");
    } catch (e) {
      setCheckMsg(String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{
      background: "var(--well)", borderRadius: "var(--radius)",
      padding: "8px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column",
    }}>
      {subs.map((s) => (
        <Row key={s.pid} title={s.title}
          hint={s.lastPub ? `最新单集 ${s.lastPub.slice(0, 10)}` : "等待首次检查"}>
          <Button variant="ghost" size="sm" onClick={() => onRemove(s.pid)}>移除</Button>
        </Row>
      ))}
      <Row title="添加节目" hint={err || "粘贴小宇宙节目页或任意一集的链接"}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <Input
            value={url}
            placeholder="https://www.xiaoyuzhoufm.com/…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            style={{ width: 264 }}
            aria-label="订阅链接"
          />
          <Button variant="secondary" size="sm" onClick={add} disabled={busy}>
            {busy ? "添加中…" : "添加"}
          </Button>
        </div>
      </Row>
      <Row title="立即检查" hint={checkMsg || "不等定时轮询,现在就查一遍更新"} last>
        <Button variant="secondary" size="sm" onClick={check} disabled={checking}>
          {checking ? "检查中…" : "检查"}
        </Button>
      </Row>
    </div>
  );
}

export function Settings({
  view, onChangeField, onSaveKeys, onChooseDir, onBack,
  subs = [], onAddSub = async () => {}, onRemoveSub = () => {}, onCheckSubs = async () => 0,
}) {
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
            hint="转写服务密钥,只存在本机">
            <KeyInput saved={view.asrKeySet} label="百炼 API Key" onSave={(v) => onSaveKeys({ asrKey: v })} />
          </Row>
          <Row title="百炼 API 地址" hint="转写服务网关,清空恢复默认">
            <TextField value={view.asrHost} fallback={DEFAULTS.asrHost}
              onSave={(v) => onChangeField({ asrHost: v })} label="百炼 API 地址" />
          </Row>
          <Row title={<><span>LLM API Key</span><StatusLabel tone={view.llmKeySet ? "ready" : "dim"}>{view.llmKeySet ? "已保存" : "未设置"}</StatusLabel></>}
            hint="笔记生成密钥,只存在本机">
            <KeyInput saved={view.llmKeySet} label="LLM API Key" onSave={(v) => onSaveKeys({ llmKey: v })} />
          </Row>
          <Row title="LLM 网关地址" hint="填到 /v1 为止,请求路径由协议决定">
            <TextField value={view.llmBaseUrl} fallback={DEFAULTS.llmBaseUrl}
              onSave={(v) => onChangeField({ llmBaseUrl: v })} label="LLM 网关地址" />
          </Row>
          <Row title="LLM 协议" hint="按网关支持选择:/responses · /chat/completions · /messages">
            <Segmented
              options={LLM_PROTOCOLS}
              value={view.llmApi || DEFAULTS.llmApi}
              onChange={(v) => onChangeField({ llmApi: v })}
              style={{ width: 264 }}
            />
          </Row>
          <Row title="笔记模型" hint="模型 ID,按网关支持填写,清空恢复默认">
            <TextField value={view.llmModel} fallback={DEFAULTS.llmModel}
              onSave={(v) => onChangeField({ llmModel: v })} label="笔记模型" width={200} />
          </Row>
          <Row title="朗读音色" hint="qwen3-tts-flash 音色,如 Cherry/Ethan,清空恢复默认">
            <TextField value={view.ttsVoice} fallback={DEFAULTS.ttsVoice}
              onSave={(v) => onChangeField({ ttsVoice: v })} label="朗读音色" width={200} />
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
            title="订阅自动处理"
            hint="关注的节目更新后自动转写并生成笔记,每 30 分钟检查一次"
            last
          >
            <Lever on={!!view.subAuto} onChange={(on) => onChangeField({ subAuto: on })} />
          </Row>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
          <StatusLabel>订阅的节目</StatusLabel>
        </div>
        <Subscriptions subs={subs} onAdd={onAddSub} onRemove={onRemoveSub} onCheck={onCheckSubs} />
      </div>
    </div>
  );
}
