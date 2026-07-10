// 磁带架(左栏) — 布局与「Podnote 正式设计 standalone.html」一致
// 收件箱模型:默认只列未读,频道条筛选,已归档单独一屉
import { Button } from "../components/core.jsx";
import { StatusLabel, EpisodeItem } from "../components/instrument.jsx";

/** 频道筛选片:mono 小字,带未读数 */
function Chip({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
        padding: "3px 8px", cursor: "pointer",
        background: active ? "var(--fill-active)" : "none",
        border: active ? "1px solid var(--ink)" : "1px solid var(--line-soft)",
        borderRadius: "var(--radius-sm)",
        color: active ? "var(--ink)" : "var(--scale)",
        transition: "border-color var(--dur) var(--ease), color var(--dur) var(--ease)",
      }}
    >
      {label}
      {count > 0 ? ` ${count}` : ""}
    </button>
  );
}

export function Rack({
  episodes, activeId, onSelect, onAdd, onSettings,
  shows = null, filterShow = null, onFilterShow,
  archivedCount = 0, showArchived = false, onToggleArchived,
}) {
  const totalUnread = (shows ?? []).reduce((n, s) => n + s.unread, 0);
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
        }}>{episodes.length} 盘{shows ? (showArchived ? "已归档" : "未读") : "磁带"}</span>
      </div>
      <div style={{ padding: "8px 16px", boxSizing: "border-box", width: "100%" }}>
        <Button variant="secondary" size="md" onClick={onAdd} style={{ width: "100%" }}>+ 添加剧集</Button>
      </div>
      {shows && shows.length > 0 && (
        <div style={{ padding: "4px 16px 8px", boxSizing: "border-box", display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Chip label="全部" count={totalUnread} active={!filterShow} onClick={() => onFilterShow?.(null)} />
          {shows.map((s) => (
            <Chip key={s.name} label={s.name} count={s.unread}
              active={filterShow === s.name} onClick={() => onFilterShow?.(s.name)} />
          ))}
        </div>
      )}
      <div style={{
        flex: 1, minHeight: 0, overflow: "auto", padding: "4px 16px 16px",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        {episodes.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <StatusLabel tone="dim">
              {showArchived ? "还没有归档" : archivedCount > 0 ? "全部处理完了" : "磁带架是空的"}
            </StatusLabel>
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
            style={{ width: "100%", flex: "none", opacity: ep.readAt ? 0.65 : 1 }}
          />
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--line-faint)", padding: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <Button variant="ghost" size="md" onClick={onSettings} style={{ flex: 1, textAlign: "left" }}>设置</Button>
        {onToggleArchived && (
          <Button variant="ghost" size="md" onClick={onToggleArchived} style={{ flex: "none" }}>
            {showArchived ? "← 未读" : `已归档 ${archivedCount}`}
          </Button>
        )}
      </div>
    </div>
  );
}
