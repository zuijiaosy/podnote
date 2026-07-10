// 磁带架(左栏) — 布局与「Podnote 正式设计 standalone.html」一致
// 收件箱模型:架顶「未读|已归档」分段视图控件(视图+计数合一),
// 频道条只管过滤,手动添加收成紧凑键(订阅时代它是低频动作),页脚只留设置
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

/** 视图分段控件:未读 N | 已归档 M —— 当前视图与计数一眼可见 */
function ViewSwitch({ showArchived, unread, archived, onToggle }) {
  const cell = (active) => ({
    flex: 1, padding: "5px 0", textAlign: "center",
    fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
    letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
    cursor: active ? "default" : "pointer", userSelect: "none",
    background: active ? "var(--fill-active)" : "transparent",
    color: active ? "var(--ink)" : "var(--scale)",
    border: active ? "1px solid var(--ink)" : "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    transition: "background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
  });
  return (
    <div style={{
      display: "flex", gap: 4, padding: 3,
      background: "var(--panel)", border: "1px solid var(--line-soft)",
      borderRadius: "var(--radius)", boxSizing: "border-box",
    }}>
      <button style={cell(!showArchived)} onClick={() => showArchived && onToggle()}>
        未读 {unread}
      </button>
      <button style={cell(showArchived)} onClick={() => !showArchived && onToggle()}>
        已归档 {archived}
      </button>
    </div>
  );
}

export function Rack({
  episodes, activeId, onSelect, onAdd, onSettings,
  shows = null, filterShow = null, onFilterShow,
  archivedCount = 0, showArchived = false, onToggleArchived,
}) {
  const totalUnread = (shows ?? []).reduce((n, s) => n + s.unread, 0);
  const inboxMode = !!onToggleArchived; // 实况模式;设计评审模式(DemoApp)保持旧布局
  return (
    <div style={{
      width: "var(--sidebar-w)", flex: "none",
      background: "var(--well)", borderRadius: "var(--radius)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px", boxSizing: "border-box" }}>
        <StatusLabel>PODNOTE</StatusLabel>
        <span style={{ flex: 1 }} />
        {inboxMode ? (
          <Button variant="secondary" size="sm" onClick={onAdd}>+ 添加</Button>
        ) : (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
            letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
            color: "var(--scale)",
          }}>{episodes.length} 盘磁带</span>
        )}
      </div>
      {!inboxMode && (
        <div style={{ padding: "8px 16px", boxSizing: "border-box", width: "100%" }}>
          <Button variant="secondary" size="md" onClick={onAdd} style={{ width: "100%" }}>+ 添加剧集</Button>
        </div>
      )}
      {inboxMode && (
        <div style={{ padding: "4px 16px 8px", boxSizing: "border-box" }}>
          <ViewSwitch
            showArchived={showArchived}
            unread={totalUnread}
            archived={archivedCount}
            onToggle={onToggleArchived}
          />
        </div>
      )}
      {shows && shows.length > 0 && (
        <div style={{ padding: "0 16px 8px", boxSizing: "border-box", display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Chip label="全部" count={0} active={!filterShow} onClick={() => onFilterShow?.(null)} />
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
      <div style={{ borderTop: "1px solid var(--line-faint)", padding: 8, display: "flex", alignItems: "center" }}>
        <Button variant="ghost" size="md" onClick={onSettings} style={{ width: "100%", textAlign: "left" }}>设置</Button>
      </div>
    </div>
  );
}
