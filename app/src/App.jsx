// Podnote 主窗口 — Tauri 内为实况模式(Rust commands/events);浏览器内为设计评审模式(fixtures)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rack } from "./screens/Rack.jsx";
import { NoteView } from "./screens/NoteView.jsx";
import { Empty } from "./screens/Empty.jsx";
import { AddFlow } from "./screens/AddFlow.jsx";
import { Settings } from "./screens/Settings.jsx";
import { DemoApp } from "./screens/DemoApp.jsx";
import { inTauri, api, uiStatus, uiStatusLabel } from "./lib/backend.js";
import { fmt } from "./lib/format.js";

const STAGE_ORDER = ["RESOLVE", "TRANSCRIBE", "SUMMARIZE", "READY"];

function LiveApp() {
  const [records, setRecords] = useState([]);
  const [notes, setNotes] = useState({});     // id -> {meta, note}
  const [stageMap, setStageMap] = useState({}); // id -> {STAGE: {status, detail}}
  const [settingsView, setSettingsView] = useState(null);
  const [view, setView] = useState("notes");
  const [activeId, setActiveId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addAct, setAddAct] = useState("input");
  const [addUrl, setAddUrl] = useState("");
  const [addErr, setAddErr] = useState("");
  const addingIdRef = useRef(null);
  const [playFrac, setPlayFrac] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const refresh = useCallback(async () => {
    const recs = await api.getLibrary();
    setRecords(recs);
    setActiveId((cur) => cur ?? recs[0]?.id ?? null);
  }, []);
  const loadNote = useCallback(async (id) => {
    const n = await api.getNote(id);
    if (n) setNotes((m) => ({ ...m, [id]: n }));
  }, []);
  const refreshSettings = useCallback(() => api.getSettings().then(setSettingsView), []);

  useEffect(() => {
    refresh();
    refreshSettings();
    let un;
    api
      .onProgress((p) => {
        setStageMap((m) => ({
          ...m,
          [p.id]: { ...(m[p.id] ?? {}), [p.stage]: { status: p.status, detail: p.detail } },
        }));
        if (p.status !== "processing") refresh();
        if (p.stage === "READY" && p.status === "ready") {
          loadNote(p.id);
          if (addingIdRef.current === p.id) {
            setAdding(false);
            setActiveId(p.id);
            addingIdRef.current = null;
          }
        }
        if (p.status === "error" && addingIdRef.current === p.id) {
          setAddErr(p.detail);
          setAddAct("error");
        }
      })
      .then((u) => (un = u));
    return () => un?.();
  }, [refresh, refreshSettings, loadNote]);

  // 选中已完成的剧集时按需加载笔记
  useEffect(() => {
    if (!activeId || notes[activeId]) return;
    const r = records.find((x) => x.id === activeId);
    if (r?.status === "ready") loadNote(activeId);
  }, [activeId, records, notes, loadNote]);

  const episodes = useMemo(
    () =>
      records.map((r) => {
        const st = stageMap[r.id] ?? {};
        const note = notes[r.id]?.note ?? null;
        const durationSec = notes[r.id]?.meta?.durationSec ?? r.durationSec ?? 0;
        const activeStage = r.status === "transcribing" ? "TRANSCRIBE"
          : r.status === "summarizing" ? "SUMMARIZE" : null;
        return {
          id: r.id,
          show: r.show || "小宇宙",
          title: r.title,
          date: r.date,
          durationSec,
          duration: durationSec ? fmt(durationSec) : "--:--",
          status: uiStatus(r.status),
          statusLabel: uiStatusLabel(r.status),
          elapsed: activeStage ? st[activeStage]?.detail || null : null,
          errStage: r.errStage,
          errReason: r.errMessage,
          note,
        };
      }),
    [records, stageMap, notes]
  );
  const ep = episodes.find((e) => e.id === activeId) ?? null;

  // 播放模拟(P3 换 <audio> 真实播放)
  const tick = useRef(null);
  useEffect(() => {
    if (!playing || !ep?.durationSec) return;
    tick.current = setInterval(() => {
      setPlayFrac((f) => {
        const next = f + (0.5 * speed) / ep.durationSec;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
    }, 500);
    return () => clearInterval(tick.current);
  }, [playing, speed, ep?.id, ep?.durationSec]);

  const addStages = useMemo(() => {
    const st = stageMap[addingIdRef.current] ?? {};
    return STAGE_ORDER.map((s) => ({
      label: s,
      status: st[s]?.status === "processing" ? "processing"
        : st[s]?.status === "ready" ? "ready"
        : st[s]?.status === "error" ? "error" : "off",
      meta: st[s]?.detail || "",
    }));
  }, [stageMap, adding, addAct]);

  const startAdd = async () => {
    const url = addUrl.trim();
    if (!url) return;
    try {
      setStageMap((m) => ({ ...m })); // 新任务旧灯清空由事件覆盖
      const rec = await api.addEpisode(url);
      addingIdRef.current = rec.id;
      setStageMap((m) => ({ ...m, [rec.id]: {} }));
      setAddAct("run");
      refresh();
    } catch (e) {
      setAddErr(String(e));
      setAddAct("error");
    }
  };

  const saveSettings = async (patch) => {
    const next = { ...settingsView, ...patch };
    await api.setSettings({
      asrHost: next.asrHost,
      llmBaseUrl: next.llmBaseUrl,
      llmModel: next.llmModel,
      notesDir: next.notesDir ?? null,
    });
    refreshSettings();
  };
  const saveKeys = async ({ asrKey, llmKey }) => {
    await api.setKeys(asrKey, llmKey);
    refreshSettings();
  };
  const chooseDir = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true });
    if (dir) saveSettings({ notesDir: dir });
  };

  return (
    <div style={{
      position: "relative", width: "100%", height: "100%",
      display: "flex", gap: 16, padding: 16, boxSizing: "border-box",
    }}>
      {view === "settings" ? (
        settingsView && (
          <Settings
            view={settingsView}
            onChangeField={saveSettings}
            onSaveKeys={saveKeys}
            onChooseDir={chooseDir}
            onBack={() => setView("notes")}
          />
        )
      ) : (
        <>
          <Rack
            episodes={episodes}
            activeId={activeId}
            onSelect={(id) => { setActiveId(id); setPlaying(false); setPlayFrac(0); }}
            onAdd={() => { setAdding(true); setAddAct("input"); setAddErr(""); }}
            onSettings={() => setView("settings")}
          />
          {episodes.length === 0 ? (
            <Empty
              selfCheck={{
                asrKey: !!settingsView?.asrKeySet,
                llmKey: !!settingsView?.llmKeySet,
              }}
              onAdd={() => { setAdding(true); setAddAct("input"); setAddErr(""); }}
              onGoSettings={() => setView("settings")}
            />
          ) : (
            <NoteView
              ep={ep}
              playFrac={playFrac} playing={playing} speed={speed}
              onTogglePlay={() => setPlaying((p) => !p)}
              onSeekFrac={setPlayFrac}
              onCycleSpeed={() => setSpeed((v) => ({ 1: 1.5, 1.5: 2, 2: 1 }[v]))}
              onRetry={() => ep && api.retry(ep.id)}
              onGoSettings={() => setView("settings")}
            />
          )}
        </>
      )}
      {adding && (
        <AddFlow
          act={addAct} stages={addStages} url={addUrl} errMessage={addErr}
          onUrlChange={setAddUrl}
          onStart={startAdd}
          onEditUrl={() => setAddAct("input")}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  return inTauri ? <LiveApp /> : <DemoApp />;
}
