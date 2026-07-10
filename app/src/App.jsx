// Podnote 主窗口 — Tauri 内为实况模式(Rust commands/events);浏览器内为设计评审模式(fixtures)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rack } from "./screens/Rack.jsx";
import { NoteView } from "./screens/NoteView.jsx";
import { Empty } from "./screens/Empty.jsx";
import { AddFlow } from "./screens/AddFlow.jsx";
import { Settings } from "./screens/Settings.jsx";
import { DemoApp } from "./screens/DemoApp.jsx";
import { inTauri, api, uiStatus, uiStatusLabel, STAGE_ZH } from "./lib/backend.js";
import { extractPeaks } from "./lib/audio.js";
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
  const [audioInfo, setAudioInfo] = useState({}); // id -> {url, peaks}
  const [dlPct, setDlPct] = useState(null);
  const [transcripts, setTranscripts] = useState({}); // id -> sentences[]
  const audioRef = useRef(null);
  const speedRef = useRef(1); // WebKit 在 play() 时会重置 playbackRate,须在开始播放后补设

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
  const [subs, setSubs] = useState([]);
  const refreshSubs = useCallback(() => api.getSubscriptions().then(setSubs), []);

  // 订阅自动入库/订阅表变化 → 刷新磁带架与订阅列表
  useEffect(() => {
    refreshSubs();
    let un;
    api.onSubscriptionsChanged(() => { refresh(); refreshSubs(); }).then((u) => (un = u));
    return () => un?.();
  }, [refresh, refreshSubs]);

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

  // ===== 真实播放引擎:<audio> + asset 协议 + Web Audio 波形峰值 =====
  const registerAudio = useCallback(async (id, path) => {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const url = convertFileSrc(path);
    setAudioInfo((m) => ({ ...m, [id]: { url, peaks: m[id]?.peaks ?? null } }));
    extractPeaks(url)
      .then((peaks) => setAudioInfo((m) => ({ ...m, [id]: { ...(m[id] ?? { url }), peaks } })))
      .catch(() => {}); // 解码失败只影响波形观感,不影响播放
    return url;
  }, []);

  // 选中已完成剧集时:已下载过的音频直接注册(波形/秒播就绪)
  useEffect(() => {
    if (!activeId || audioInfo[activeId]) return;
    const r = records.find((x) => x.id === activeId);
    if (r?.status !== "ready") return;
    api.getAudioPath(activeId).then((p) => { if (p) registerAudio(activeId, p); });
  }, [activeId, records, audioInfo, registerAudio]);

  // 音频下载进度 → PLAY 按钮百分比
  const activeIdRef = useRef(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => {
    let un;
    api.onAudioProgress((p) => {
      if (p.id === activeIdRef.current) setDlPct(p.pct);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  const togglePlay = async () => {
    const a = audioRef.current;
    if (!ep || !a) return;
    if (playing) { a.pause(); return; }
    let info = audioInfo[ep.id];
    if (!info) {
      // 首次播放:先把音频拉到本地
      setDlPct(0);
      try {
        const path = await api.downloadAudio(ep.id);
        info = { url: await registerAudio(ep.id, path) };
      } catch (e) {
        console.error("音频下载失败", e);
        return;
      } finally {
        setDlPct(null);
      }
    }
    if (a.dataset.epid !== ep.id) {
      a.src = info.url;
      a.dataset.epid = ep.id;
      a.currentTime = playFrac * ep.durationSec;
    }
    a.play()
      .then(() => { a.playbackRate = speedRef.current; })
      .catch((e) => console.error("播放失败", e));
  };

  // 回车/空格 = 播放/暂停(窗口激活、不在输入框/按钮/弹窗/设置页时)
  const togglePlayRef = useRef(() => {});
  useEffect(() => { togglePlayRef.current = togglePlay; });
  useEffect(() => {
    if (adding || view !== "notes") return;
    const onKey = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
      e.preventDefault(); // 空格默认滚动页面
      togglePlayRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, view]);

  const seekFrac = (f) => {
    setPlayFrac(f);
    const a = audioRef.current;
    if (a && ep && a.dataset.epid === ep.id && Number.isFinite(a.duration)) {
      a.currentTime = f * a.duration;
    }
  };

  const cycleSpeed = () => {
    const next = { 1: 1.5, 1.5: 2, 2: 1 }[speed];
    setSpeed(next);
    speedRef.current = next;
    const a = audioRef.current;
    if (a) {
      a.defaultPlaybackRate = next;
      a.playbackRate = next;
    }
  };

  const addStages = useMemo(() => {
    const st = stageMap[addingIdRef.current] ?? {};
    return STAGE_ORDER.map((s) => ({
      label: STAGE_ZH[s] ?? s,
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
      subAuto: next.subAuto ?? true,
    });
    refreshSettings();
  };
  const addSub = async (url) => { await api.addSubscription(url); refreshSubs(); };
  const removeSub = async (pid) => { await api.removeSubscription(pid); refreshSubs(); };
  const checkSubs = async () => {
    const n = await api.checkSubscriptions();
    refresh();
    refreshSubs();
    return n;
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
            subs={subs}
            onAddSub={addSub}
            onRemoveSub={removeSub}
            onCheckSubs={checkSubs}
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
            onSelect={(id) => {
              audioRef.current?.pause();
              setActiveId(id);
              setPlayFrac(0);
              setDlPct(null);
            }}
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
              bars={audioInfo[ep?.id]?.peaks ?? null}
              downloadPct={dlPct}
              transcript={transcripts[ep?.id] ?? null}
              onLoadTranscript={() => {
                if (!ep || transcripts[ep.id]) return;
                api.getTranscript(ep.id).then((s) => {
                  if (s) setTranscripts((m) => ({ ...m, [ep.id]: s }));
                });
              }}
              onTogglePlay={togglePlay}
              onSeekFrac={seekFrac}
              onCycleSpeed={cycleSpeed}
              onRetry={() => ep && api.retry(ep.id)}
              onGoSettings={() => setView("settings")}
            />
          )}
        </>
      )}
      <audio
        ref={audioRef}
        style={{ display: "none" }}
        onPlay={(e) => { setPlaying(true); e.currentTarget.playbackRate = speedRef.current; }}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speedRef.current; }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (Number.isFinite(a.duration) && a.duration > 0) {
            setPlayFrac(a.currentTime / a.duration);
          }
        }}
      />
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
