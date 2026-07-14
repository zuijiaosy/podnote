// 订阅 — 独立屏:节目增删与手动检查是日常操作,不和"配好就不再来"的设置混住
// 自动处理的开关(策略)留在设置页,这里只陈述它的状态
import { useState } from "react";
import { Button, FieldRow, Input } from "../components/core.jsx";
import { StatusLabel } from "../components/instrument.jsx";

export function Subscriptions({
  subs = [], auto = false,
  onAdd = async () => {}, onRemove = () => {}, onCheck = async () => 0, onBack,
}) {
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
      flex: 1, minWidth: 0, overflow: "auto",
      display: "flex", justifyContent: "center", padding: "48px 0", boxSizing: "border-box",
      animation: "pn-enter var(--dur-slow) var(--ease) both",
    }}>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 16, height: "fit-content" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusLabel>订阅</StatusLabel>
          <StatusLabel tone="dim">{auto ? "自动检查 · 每 30 分钟" : "自动检查已关闭"}</StatusLabel>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onBack}>返回</Button>
        </div>
        <div style={{
          background: "var(--well)", borderRadius: "var(--radius)",
          padding: "8px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column",
        }}>
          {subs.length === 0 && (
            <FieldRow title="还没有订阅" hint="添加节目后,新单集会自动出现在磁带架上" />
          )}
          {subs.map((s) => (
            <FieldRow key={s.pid} title={s.title}
              hint={s.lastPub ? `最新单集 ${s.lastPub.slice(0, 10)}` : "等待首次检查"}>
              <Button variant="ghost" size="sm" onClick={() => onRemove(s.pid)}>移除</Button>
            </FieldRow>
          ))}
          <FieldRow title="添加节目" hint={err || "粘贴小宇宙节目页或任意一集的链接"}>
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
          </FieldRow>
          <FieldRow title="立即检查" hint={checkMsg || "现在就查一遍更新;新单集会自动处理,消耗 API 额度"} last>
            <Button variant="secondary" size="sm" onClick={check} disabled={checking}>
              {checking ? "检查中…" : "检查"}
            </Button>
          </FieldRow>
        </div>
      </div>
    </div>
  );
}
