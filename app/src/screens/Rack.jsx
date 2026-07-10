// 磁带架(左栏) — 布局与「Podnote 正式设计 standalone.html」一致
import { Button } from "../components/core.jsx";
import { StatusLabel, EpisodeItem } from "../components/instrument.jsx";

export function Rack({ episodes, activeId, onSelect, onAdd, onSettings }) {
  return (
    <div style={{
      width: "var(--sidebar-w)", flex: "none",
      background: "var(--well)", borderRadius: "var(--radius)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px", boxSizing: "border-box" }}>
        <StatusLabel>PODNOTE</StatusLabel>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
          letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
          color: "var(--scale)",
        }}>{episodes.length} 盘磁带</span>
      </div>
      <div style={{ padding: "8px 16px", boxSizing: "border-box", width: "100%" }}>
        <Button variant="secondary" size="md" onClick={onAdd} style={{ width: "100%" }}>+ 添加剧集</Button>
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflow: "auto", padding: "4px 16px 16px",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        {episodes.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <StatusLabel tone="dim">磁带架是空的</StatusLabel>
          </div>
        )}
        {episodes.map((ep) => (
          <EpisodeItem
            key={ep.id}
            date={ep.date} show={ep.show} title={ep.title}
            duration={ep.status === "processing" && ep.elapsed ? ep.elapsed : ep.duration}
            status={ep.status} statusLabel={ep.statusLabel}
            errReason={ep.errReason}
            active={ep.id === activeId}
            onClick={() => onSelect(ep.id)}
            style={{ width: "100%", flex: "none" }}
          />
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--line-faint)", padding: 8, display: "flex", alignItems: "center" }}>
        <Button variant="ghost" size="md" onClick={onSettings} style={{ width: "100%", textAlign: "left" }}>设置</Button>
      </div>
    </div>
  );
}
