// 磁带架(左栏) — 宪法 v4「双皮肤仪器」:机壳面板 + 卡片式磁带
// 收件箱模型:架顶「未读|已归档」分段视图控件(视图+计数合一),
// 频道条只管过滤,手动添加收成紧凑键(订阅时代它是低频动作),页脚只留设置
import { useEffect, useRef, useState } from "react";
import { Button, Segmented } from "../components/core.jsx";
import { StatusLabel, EpisodeItem } from "../components/instrument.jsx";

/** 频道筛选片:凹槽/浮键同一套仪器语言;选中 = 浮起的键,带未读数;长名截断悬停见全名 */
function Chip({ label, count = 0, active, onClick, onContextMenu }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 5, maxWidth: "100%", minWidth: 0,
        fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)",
        fontWeight: active ? "var(--weight-medium)" : "var(--weight-regular)",
        fontVariantNumeric: "tabular-nums",
        padding: "2px 10px 3px", cursor: "pointer",
        background: active ? "var(--surface-2)" : hover ? "var(--fill-hover)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-ctl)",
        boxShadow: active ? "var(--shadow-key)" : "none",
        color: active ? "var(--txt)" : "var(--dim)",
        transition: "background var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {count > 0 && (
        <span style={{
          flex: "none", fontFamily: "var(--font-data)", fontSize: "var(--text-xs)",
          color: active ? "var(--accent)" : "var(--faint)",
        }}>{count}</span>
      )}
    </button>
  );
}

/** 频道条默认最多露出的频道数,超出收进「+N」 */
const CHIP_LIMIT = 6;

/** 磁带架右键菜单:材质与 NoteView 的 ContextMenu 同源;点击项后原位显示结果回执再自动收起 */
function RackMenu({ menu, onClose }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const gen = useRef(0);
  // 换代:清回执与定时器,并令进行中的旧动作作废(await 回来对不上代号就丢弃)
  useEffect(() => {
    gen.current += 1;
    setMsg("");
    setBusy(false);
    return () => clearTimeout(timer.current);
  }, [menu]);
  const run = async (it) => {
    if (busy) return;
    const g = gen.current;
    setBusy(true);
    let receipt;
    try {
      const r = await it.onClick();
      receipt = (typeof r === "string" && r) || it.doneLabel || "完成";
    } catch (e) {
      receipt = String(e);
    }
    if (gen.current !== g) return; // 菜单已换,这个回执不属于当前菜单
    setMsg(receipt);
    timer.current = setTimeout(onClose, 2200);
  };
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "absolute", top: menu.top, left: menu.left, zIndex: 3, minWidth: 150, maxWidth: 220,
        background: "var(--paper)", border: "1px solid var(--line-faint)",
        boxShadow: "var(--shadow-pop)",
        borderRadius: "var(--radius)", padding: 4, boxSizing: "border-box",
        display: "flex", flexDirection: "column",
        animation: "pn-pop var(--dur) var(--ease) both",
      }}
    >
      {msg ? (
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--ink)",
          padding: "8px 12px", lineHeight: 1.5,
        }}>{msg}</div>
      ) : (
        menu.items.map((it, i) => (
          <button
            key={i}
            onClick={busy ? undefined : () => run(it)}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--fill-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            style={{
              fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--ink)",
              background: "transparent", border: "none", borderRadius: "var(--radius-sm)",
              padding: "8px 12px", textAlign: "left", cursor: "pointer",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >{it.label}</button>
        ))
      )}
    </div>
  );
}

/** 视图分段控件:未读 N | 已归档 M —— 凹槽轨道 + 浮起选中键,当前视图与计数一眼可见 */
function ViewSwitch({ showArchived, unread, archived, onToggle }) {
  return (
    <Segmented
      options={[
        { value: "unread", label: `未读 ${unread}` },
        { value: "archived", label: `已归档 ${archived}` },
      ]}
      value={showArchived ? "archived" : "unread"}
      onChange={() => onToggle()}
    />
  );
}

export function Rack({
  episodes, activeId, onSelect, onAdd, onSettings, onSubs,
  shows = null, filterShow = null, onFilterShow,
  archivedCount = 0, unreadCount = 0, showArchived = false, onToggleArchived,
  onExportEpisode, onExportShow,
}) {
  const inboxMode = !!onToggleArchived; // 实况模式;设计评审模式(DemoApp)保持旧布局
  const [chipsOpen, setChipsOpen] = useState(false);
  // 右键菜单:{top, left, items};坐标相对 Rack 容器
  const [menu, setMenu] = useState(null);
  const rootRef = useRef(null);
  /** 在鼠标处弹菜单;右缘防溢出 */
  const popMenu = (e, items) => {
    e.preventDefault();
    if (!items.length) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({
      // 双向防溢出:root 是 overflow hidden,贴底/贴右的菜单会被裁掉
      top: Math.min(e.clientY - rect.top, rect.height - 96),
      left: Math.min(e.clientX - rect.left, rect.width - 160),
      items,
    });
  };
  return (
    <div
      ref={rootRef}
      className="pn-unit"
      onMouseDown={() => { if (menu) setMenu(null); }}
      style={{
        width: "var(--sidebar-w)", flex: "none", position: "relative",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
      {menu && <RackMenu menu={menu} onClose={() => setMenu(null)} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 10px", boxSizing: "border-box" }}>
        <span style={{
          fontFamily: "var(--font-ui)", fontSize: "var(--text-base)",
          fontWeight: "var(--weight-display)", letterSpacing: "-0.01em", color: "var(--txt)",
        }}>Podnote</span>
        <span style={{
          fontFamily: "var(--font-data)", fontSize: 9,
          letterSpacing: "0.12em", color: "var(--faint)", marginTop: 2,
        }}>TAPE ARCHIVE</span>
        <span style={{ flex: 1 }} />
        {inboxMode ? (
          <Button variant="knob" size="sm" onClick={onAdd}>＋ 添加</Button>
        ) : (
          <span style={{
            fontFamily: "var(--font-data)", fontSize: "var(--text-sm)",
            letterSpacing: "var(--tracking-machine)", fontVariantNumeric: "tabular-nums",
            color: "var(--dim)",
          }}>{episodes.length} 盘磁带</span>
        )}
      </div>
      {!inboxMode && (
        <div style={{ padding: "8px 16px", boxSizing: "border-box", width: "100%" }}>
          <Button variant="secondary" size="md" onClick={onAdd} style={{ width: "100%" }}>+ 添加剧集</Button>
        </div>
      )}
      {inboxMode && (
        <div style={{ padding: "4px 16px 10px", boxSizing: "border-box" }}>
          <ViewSwitch
            showArchived={showArchived}
            unread={unreadCount}
            archived={archivedCount}
            onToggle={onToggleArchived}
          />
        </div>
      )}
      {shows && shows.length > 0 && (() => {
        // 折叠态:最多露 CHIP_LIMIT 个;当前筛选的频道被折进去时换到可见区,激活态不许隐身
        let visible = chipsOpen ? shows : shows.slice(0, CHIP_LIMIT);
        if (!chipsOpen && filterShow && !visible.some((s) => s.name === filterShow)) {
          const cur = shows.find((s) => s.name === filterShow);
          if (cur) visible = [...visible.slice(0, CHIP_LIMIT - 1), cur];
        }
        const hidden = shows.length - visible.length;
        return (
          <div style={{ padding: "0 16px 14px", boxSizing: "border-box", display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
            <Chip label="全部" count={0} active={!filterShow} onClick={() => onFilterShow?.(null)} />
            {visible.map((s) => (
              <Chip key={s.name} label={s.name} count={s.unread}
                active={filterShow === s.name} onClick={() => onFilterShow?.(s.name)}
                onContextMenu={onExportShow ? (e) => popMenu(e, [{
                  label: `导出「${s.name}」全部笔记`,
                  doneLabel: "已导出,详见通知",
                  onClick: () => onExportShow(s.name),
                }]) : undefined}
              />
            ))}
            {hidden > 0 && <Chip label={`+${hidden}`} onClick={() => setChipsOpen(true)} />}
            {chipsOpen && shows.length > CHIP_LIMIT && (
              <Chip label="收起" onClick={() => setChipsOpen(false)} />
            )}
          </div>
        );
      })()}
      <div
        /* 视图/筛选切换时重挂载,触发列表逐条扫入 */
        key={`${showArchived}|${filterShow ?? ""}`}
        style={{
          flex: 1, minHeight: 0, overflow: "auto", padding: "6px 12px 14px",
          display: "flex", flexDirection: "column", gap: 9,
        }}>
        {episodes.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <StatusLabel tone="dim">
              {showArchived ? "还没有归档" : archivedCount > 0 ? "全部处理完了" : "磁带架是空的"}
            </StatusLabel>
          </div>
        )}
        {episodes.map((ep, i) => (
          <EpisodeItem
            key={ep.id}
            date={ep.date} show={ep.show} title={ep.title}
            duration={ep.status === "processing" && ep.elapsed ? ep.elapsed : ep.duration}
            status={ep.status} statusLabel={ep.statusLabel}
            errReason={ep.errReason}
            active={ep.id === activeId}
            onClick={() => onSelect(ep.id)}
            onContextMenu={onExportEpisode && ep.status === "ready" ? (e) => popMenu(e, [{
              label: "导出笔记到库",
              doneLabel: "已导出",
              onClick: () => onExportEpisode(ep.id),
            }]) : undefined}
            style={{
              width: "100%", flex: "none",
              /* 归档变暗走 filter:与入场动画的 opacity 通道解耦(fill 会把 opacity 钉在 1) */
              filter: ep.readAt ? "opacity(0.65)" : "none",
              /* 逐条扫入,第 10 条后不再递增延迟 */
              animation: "pn-enter var(--dur-slow) var(--ease) both",
              animationDelay: `${Math.min(i, 10) * 15}ms`,
            }}
          />
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--line-faint)", padding: 8, display: "flex", alignItems: "center", gap: 4 }}>
        {onSubs && (
          <Button variant="ghost" size="md" onClick={onSubs}>订阅</Button>
        )}
        <Button variant="ghost" size="md" onClick={onSettings}>设置</Button>
      </div>
    </div>
  );
}
