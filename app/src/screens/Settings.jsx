// 设置 — 三层结构:接入(必需)/ 增强(可选)/ 高级(默认折叠)
// 失焦即存 + 行内"已存"回执;密钥显后四位、可清除;连接自检发最小真实请求验证"钥匙能开门"
// 订阅管理是日常操作,已迁出到独立的订阅屏(screens/Subscriptions.jsx)
import { useRef, useState } from "react";
import { Button, FieldRow, Input, Lever, Segmented, Select } from "../components/core.jsx";
import { StatusLabel, IndicatorLight } from "../components/instrument.jsx";

const DEFAULTS = {
  asrHost: "https://llm-xy8sn8964kplkx1s.cn-beijing.maas.aliyuncs.com",
  llmApi: "openai-responses",
  ttsVoice: "Cherry",
};

const LLM_PROTOCOLS = [
  { value: "openai-responses", label: "Responses" },
  { value: "openai-completions", label: "Chat" },
  { value: "anthropic-messages", label: "Claude" },
];

/** qwen3-tts-flash 常用音色;Select 会原样保留不在列表里的旧值 */
const TTS_VOICES = [
  { value: "Cherry", label: "Cherry · 芊悦" },
  { value: "Ethan", label: "Ethan · 晨煦" },
  { value: "Nofish", label: "Nofish · 不吃鱼" },
  { value: "Jennifer", label: "Jennifer · 詹妮弗" },
  { value: "Ryan", label: "Ryan · 甜茶" },
  { value: "Dylan", label: "Dylan · 北京晓东" },
  { value: "Sunny", label: "Sunny · 四川晴儿" },
];

function Card({ children }) {
  return (
    <div style={{
      background: "var(--well)", borderRadius: "var(--radius)",
      padding: "8px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column",
    }}>{children}</div>
  );
}

/** 失焦即存的回执:1.6 秒的"已存"丝印 */
function useSavedFlash() {
  const [on, setOn] = useState(false);
  const t = useRef(null);
  const fire = () => {
    setOn(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setOn(false), 1600);
  };
  return [on, fire];
}

function KeyInput({ saved, hint, onSave, onClear, label }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      <Input
        type="password"
        value={val}
        placeholder={saved ? `····${hint} · 输入以更换` : "sk-…"}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { if (val.trim()) { onSave(val.trim()); setVal(""); } }}
        style={{ width: saved ? 200 : 264 }}
        aria-label={label}
      />
      {saved && <Button variant="ghost" size="sm" onClick={onClear}>清除</Button>}
    </div>
  );
}

/** 文本配置项:失焦即存 + "已存"回执;清空时回落 fallback(必填项 fallback 为空串) */
function TextField({ value, fallback = "", placeholder, onSave, label, width = 264 }) {
  const [flash, fire] = useSavedFlash();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      {flash && <StatusLabel tone="ready">已存</StatusLabel>}
      <Input
        key={value}
        defaultValue={value}
        placeholder={placeholder ?? fallback}
        onBlur={(e) => {
          const v = e.target.value.trim() || fallback;
          if (v !== value) { onSave(v); fire(); }
        }}
        style={{ width }}
        aria-label={label}
      />
    </div>
  );
}

/** 密钥行标题:名称 + 保存状态;必需项缺失亮信号橙 */
function KeyTitle({ name, saved, required }) {
  return (
    <>
      <span>{name}</span>
      <StatusLabel tone={saved ? "ready" : required ? "signal" : "dim"}>
        {saved ? "已保存" : "未设置"}
      </StatusLabel>
    </>
  );
}

/** 连接自检:各发一个最小真实请求;灯只在自检后亮,不拿"有钥匙"冒充"能开门" */
function SelfCheck({ tavilySet, onTestAsr, onTestLlm, onTestTavily }) {
  const [st, setSt] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    const jobs = [
      ["asr", "转写", onTestAsr],
      ["llm", "笔记", onTestLlm],
      ...(tavilySet ? [["tavily", "搜索", onTestTavily]] : []),
    ];
    setSt(Object.fromEntries(jobs.map(([k]) => [k, "processing"])));
    const results = await Promise.allSettled(jobs.map(([, , fn]) => fn()));
    setSt(Object.fromEntries(jobs.map(([k], i) => [k, results[i].status === "fulfilled" ? "ready" : "error"])));
    setMsg(
      jobs
        .map(([, name], i) => (results[i].status === "rejected" ? `${name}:${String(results[i].reason)}` : null))
        .filter(Boolean)
        .join(" · ")
    );
    setBusy(false);
  };
  return (
    <FieldRow title="连接自检" hint={msg || "各发一个最小请求,验证钥匙、网关和模型真的能用"} last>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "none" }}>
        <IndicatorLight status={st.asr ?? "off"} label="转写" />
        <IndicatorLight status={st.llm ?? "off"} label="笔记" />
        {tavilySet && <IndicatorLight status={st.tavily ?? "off"} label="搜索" />}
        <Button variant="secondary" size="sm" onClick={run} disabled={busy}>
          {busy ? "自检中…" : "自检"}
        </Button>
      </div>
    </FieldRow>
  );
}

/** 高级:动过的人才需要看见;改过默认值则展开着陈述现状 */
function Advanced({ view, onChangeField }) {
  const [open, setOpen] = useState(!!view.asrHost && view.asrHost !== DEFAULTS.asrHost);
  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "12px 0",
          background: "none", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <StatusLabel tone="dim">高级</StatusLabel>
        <span style={{ flex: 1 }} />
        <StatusLabel tone="dim">{open ? "收起" : "展开"}</StatusLabel>
      </button>
      {open && (
        <FieldRow title="百炼 API 地址" hint="转写与朗读的服务网关;不明白它是什么就不用改" last>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
            {view.asrHost !== DEFAULTS.asrHost && (
              <Button variant="ghost" size="sm" onClick={() => onChangeField({ asrHost: DEFAULTS.asrHost })}>
                恢复默认
              </Button>
            )}
            <TextField value={view.asrHost} fallback={DEFAULTS.asrHost}
              onSave={(v) => onChangeField({ asrHost: v })} label="百炼 API 地址" width={216} />
          </div>
        </FieldRow>
      )}
    </Card>
  );
}

export function Settings({
  view, onChangeField, onSaveKeys, onChooseDir, onBack,
  onTestAsr = async () => {}, onTestLlm = async () => {}, onTestTavily = async () => {},
  subsCount = 0, onGoSubs = () => {},
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0, overflow: "auto",
      display: "flex", justifyContent: "center", padding: "48px 0", boxSizing: "border-box",
      animation: "pn-enter var(--dur-slow) var(--ease) both",
    }}>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 16, height: "fit-content" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusLabel>设置</StatusLabel>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onBack}>返回</Button>
        </div>

        <StatusLabel tone="dim">接入 · 必需</StatusLabel>
        <Card>
          <FieldRow
            title={<KeyTitle name="百炼 API Key" saved={view.asrKeySet} required />}
            hint="转写与朗读的密钥,只存在本机"
          >
            <KeyInput saved={view.asrKeySet} hint={view.asrKeyHint}
              onSave={(v) => onSaveKeys({ asrKey: v })}
              onClear={() => onSaveKeys({ asrKey: "" })} label="百炼 API Key" />
          </FieldRow>
          <FieldRow
            title={<KeyTitle name="LLM API Key" saved={view.llmKeySet} required />}
            hint="笔记生成的密钥,只存在本机,随请求发往下面的网关"
          >
            <KeyInput saved={view.llmKeySet} hint={view.llmKeyHint}
              onSave={(v) => onSaveKeys({ llmKey: v })}
              onClear={() => onSaveKeys({ llmKey: "" })} label="LLM API Key" />
          </FieldRow>
          <FieldRow
            title={<><span>LLM 网关地址</span>{!view.llmBaseUrl && <StatusLabel tone="signal">未设置</StatusLabel>}</>}
            hint="填到 /v1 为止;你的 key 只会发给这个地址"
          >
            <TextField value={view.llmBaseUrl} placeholder="https://api.openai.com/v1"
              onSave={(v) => onChangeField({ llmBaseUrl: v })} label="LLM 网关地址" />
          </FieldRow>
          <FieldRow title="LLM 协议" hint="按网关支持选择:/responses · /chat/completions · /messages">
            <Segmented
              options={LLM_PROTOCOLS}
              value={view.llmApi || DEFAULTS.llmApi}
              onChange={(v) => onChangeField({ llmApi: v })}
              style={{ width: 264 }}
            />
          </FieldRow>
          <FieldRow
            title={<><span>笔记模型</span>{!view.llmModel && <StatusLabel tone="signal">未设置</StatusLabel>}</>}
            hint="模型 ID,按网关支持填写"
          >
            <TextField value={view.llmModel} placeholder="如 gpt-5.2"
              onSave={(v) => onChangeField({ llmModel: v })} label="笔记模型" width={200} />
          </FieldRow>
          <SelfCheck tavilySet={view.tavilyKeySet}
            onTestAsr={onTestAsr} onTestLlm={onTestLlm} onTestTavily={onTestTavily} />
        </Card>

        <StatusLabel tone="dim">增强 · 可选</StatusLabel>
        <Card>
          <FieldRow
            title={<KeyTitle name="Tavily API Key" saved={view.tavilyKeySet} />}
            hint="划词纠正与核查的搜索密钥,只存在本机"
          >
            <KeyInput saved={view.tavilyKeySet} hint={view.tavilyKeyHint}
              onSave={(v) => onSaveKeys({ tavilyKey: v })}
              onClear={() => onSaveKeys({ tavilyKey: "" })} label="Tavily API Key" />
          </FieldRow>
          <FieldRow title="朗读音色" hint="qwen3-tts-flash 音色">
            <Select options={TTS_VOICES} value={view.ttsVoice || DEFAULTS.ttsVoice}
              onChange={(v) => onChangeField({ ttsVoice: v })} style={{ width: 200 }} />
          </FieldRow>
          <FieldRow title="笔记导出目录" hint="额外导出一份 Markdown 到你的笔记库">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
                letterSpacing: "var(--tracking-machine)", color: view.notesDir ? "var(--ink)" : "var(--scale)",
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl",
              }}>{view.notesDir || "未设置"}</span>
              <Button variant="secondary" size="sm" onClick={onChooseDir}>选择</Button>
            </div>
          </FieldRow>
          <FieldRow title="资源条目 Wikilink" hint="导出的 Markdown 里资源名写成 [[链接]],喂 Obsidian 图谱">
            <Lever on={!!view.exportWikilinks} onChange={(on) => onChangeField({ exportWikilinks: on })} />
          </FieldRow>
          <FieldRow
            title="订阅自动处理"
            hint="新单集自动转写并生成笔记,每 30 分钟查一次 · 消耗你的 API 额度"
          >
            <Lever on={!!view.subAuto} onChange={(on) => onChangeField({ subAuto: on })} />
          </FieldRow>
          <FieldRow title="订阅的节目" hint="添加、移除节目和手动检查都在订阅页" last>
            <Button variant="secondary" size="sm" onClick={onGoSubs}>
              管理{subsCount > 0 ? ` (${subsCount})` : ""}
            </Button>
          </FieldRow>
        </Card>

        <Advanced view={view} onChangeField={onChangeField} />
      </div>
    </div>
  );
}
