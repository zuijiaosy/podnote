// Podnote 主窗口 — Tauri 内为实况模式(Rust commands/events);浏览器内为设计评审模式(fixtures)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rack } from "./screens/Rack.jsx";
import { NoteView } from "./screens/NoteView.jsx";
import { Empty } from "./screens/Empty.jsx";
import { AddFlow } from "./screens/AddFlow.jsx";
import { Settings } from "./screens/Settings.jsx";
import { Subscriptions } from "./screens/Subscriptions.jsx";
import { DemoApp } from "./screens/DemoApp.jsx";
import { inTauri, mockMode, api, toMediaUrl, uiStatus, uiStatusLabel, STAGE_ZH } from "./lib/backend.js";
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
  const [filterShow, setFilterShow] = useState(null); // null = 全部频道
  const [showArchived, setShowArchived] = useState(false); // false = 未读收件箱
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
  // ===== 朗读(TTS):一段一文件渐进播放,独立 <audio>,与播客原声互斥 =====
  const [ttsInfo, setTtsInfo] = useState({}); // id -> {complete, segments:[{seq,key,url|null}]}
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsWaiting, setTtsWaiting] = useState(false); // 播到了还没合成完的段,等落盘续播
  const [ttsEpId, setTtsEpId] = useState(null); // 正在/最后朗读的剧集
  const [ttsIdx, setTtsIdx] = useState(-1);     // 当前朗读段序号(高亮用)
  const [ttsGen, setTtsGen] = useState({});     // id -> {done,total} | {error}
  const [ttsRate, setTtsRate] = useState(1.5);  // 朗读倍速,独立于播客原声
  const ttsRateRef = useRef(1.5);
  const ttsAudioRef = useRef(null);
  const ttsWantRef = useRef(null); // {id, seq}:该段落盘后自动开播
  const ttsInfoRef = useRef({});
  useEffect(() => { ttsInfoRef.current = ttsInfo; }, [ttsInfo]);

  const refresh = useCallback(async () => {
    const recs = await api.getLibrary();
    setRecords(recs);
    setActiveId((cur) => cur ?? recs[0]?.id ?? null);
  }, []);
  const [correctionsMap, setCorrectionsMap] = useState({}); // id -> 纠正记录[]
  const loadNote = useCallback(async (id) => {
    const n = await api.getNote(id);
    if (n) setNotes((m) => ({ ...m, [id]: n }));
    api.getCorrections(id)
      .then((c) => { if (c) setCorrectionsMap((m) => ({ ...m, [id]: c })); })
      .catch(() => {});
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
          readAt: r.readAt ?? null,
          note,
        };
      }),
    [records, stageMap, notes]
  );
  const ep = episodes.find((e) => e.id === activeId) ?? null;

  // ===== 收件箱视图:默认只看未读,频道条筛选,已归档单独一屉 =====
  const matchView = useCallback(
    (e, archived, show) => (archived ? !!e.readAt : !e.readAt) && (!show || e.show === show),
    []
  );
  const visible = useMemo(
    () => episodes.filter((e) => matchView(e, showArchived, filterShow)),
    [episodes, showArchived, filterShow, matchView]
  );
  // 频道条计数跟随当前视图:未读视图数未读,归档视图数归档(否则数字会骗人)
  const shows = useMemo(() => {
    const m = new Map();
    for (const e of episodes) {
      const s = m.get(e.show) ?? { name: e.show, unread: 0 };
      if (showArchived ? !!e.readAt : !e.readAt) s.unread += 1;
      m.set(e.show, s);
    }
    return [...m.values()];
  }, [episodes, showArchived]);
  const archivedCount = useMemo(() => episodes.filter((e) => e.readAt).length, [episodes]);
  const unreadCount = episodes.length - archivedCount;

  /** 切筛选后当前选中不在视图里时,跳到视图第一条 */
  const reselectFor = (archived, show) => {
    const v = episodes.filter((e) => matchView(e, archived, show));
    if (v.length && !v.some((x) => x.id === activeId)) setActiveId(v[0].id);
  };
  const applyFilter = (name) => { setFilterShow(name); reselectFor(showArchived, name); };
  const toggleArchivedView = () => { setShowArchived(!showArchived); reselectFor(!showArchived, filterShow); };

  const loadTts = useCallback(async (id) => {
    const got = await api.getTts(id);
    if (!got) return null;
    const info = {
      complete: got.complete,
      segments: await Promise.all(got.segments.map(async (s) => ({
        seq: s.seq, key: s.key, url: s.path ? await toMediaUrl(s.path) : null,
      }))),
    };
    setTtsInfo((m) => ({ ...m, [id]: info }));
    return info;
  }, []);

  /** 播第 seq 段;该段还没落盘则挂起等 segment 事件 */
  const playSeg = useCallback((id, seq, url) => {
    const a = ttsAudioRef.current;
    if (!a) return;
    setTtsEpId(id);
    setTtsIdx(seq);
    if (!url) {
      ttsWantRef.current = { id, seq };
      setTtsWaiting(true);
      return;
    }
    ttsWantRef.current = null;
    setTtsWaiting(false);
    audioRef.current?.pause(); // 朗读与播客原声互斥
    a.src = url;
    a.dataset.epid = id;
    a.dataset.seq = seq;
    a.play()
      .then(() => { a.playbackRate = ttsRateRef.current; })
      .catch((e) => console.error("朗读播放失败", e));
  }, []);
  const playSegRef = useRef(playSeg);
  useEffect(() => { playSegRef.current = playSeg; });

  // 合成事件:segment 落盘即登记,正好是等着的那段就立刻续播
  useEffect(() => {
    let un;
    api.onTtsProgress(async (p) => {
      if (p.status === "processing") {
        setTtsGen((m) => ({ ...m, [p.id]: { done: p.done, total: p.total } }));
      } else if (p.status === "segment") {
        const url = await toMediaUrl(p.path);
        setTtsInfo((m) => {
          const cur = m[p.id] ?? { complete: false, segments: [] };
          const segments = [...cur.segments];
          while (segments.length < p.total) {
            segments.push({ seq: segments.length, key: null, url: null });
          }
          segments[p.seq] = { seq: p.seq, key: p.key, url };
          return { ...m, [p.id]: { ...cur, segments } };
        });
        const want = ttsWantRef.current;
        if (want && want.id === p.id && want.seq === p.seq) {
          playSegRef.current(p.id, p.seq, url);
        }
      } else if (p.status === "ready") {
        setTtsGen((m) => { const n = { ...m }; delete n[p.id]; return n; });
        setTtsInfo((m) => (m[p.id] ? { ...m, [p.id]: { ...m[p.id], complete: true } } : m));
      } else if (p.status === "error") {
        ttsWantRef.current = null;
        setTtsWaiting(false);
        setTtsGen((m) => ({ ...m, [p.id]: { error: p.detail } }));
      }
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  /** 朗读/停止:首段已缓存立即播;没有就发起合成,首段落盘即开播 */
  const toggleTts = async () => {
    if (!ep) return;
    const a = ttsAudioRef.current;
    if ((ttsPlaying || ttsWaiting) && ttsEpId === ep.id) {
      ttsWantRef.current = null;
      setTtsWaiting(false);
      a?.pause();
      return;
    }
    // 同一集暂停后再点:原地续播(已播完则走下面的从头重放)
    if (ttsEpId === ep.id && a?.dataset.epid === ep.id && a.src && !a.ended && ttsIdx >= 0) {
      audioRef.current?.pause();
      a.play().then(() => { a.playbackRate = ttsRateRef.current; }).catch(() => {});
      return;
    }
    const info = ttsInfo[ep.id] ?? (await loadTts(ep.id));
    const gen = ttsGen[ep.id];
    // 缓存不完整且没有合成在跑(上次中断/失败)→ 续跑,已有的段会被跳过
    if ((!info || !info.complete) && (!gen || gen.error)) {
      setTtsGen((m) => ({ ...m, [ep.id]: { done: 0, total: info?.segments?.length ?? 0 } }));
      try {
        await api.generateTts(ep.id);
      } catch (e) {
        setTtsGen((m) => ({ ...m, [ep.id]: { error: String(e) } }));
        return;
      }
    }
    playSeg(ep.id, 0, info?.segments?.[0]?.url ?? null);
  };

  /** 朗读倍速:1 → 1.5 → 2 循环,写入设置持久化 */
  const cycleTtsRate = () => {
    const next = { 1: 1.5, 1.5: 2, 2: 1 }[ttsRate] ?? 1.5;
    setTtsRate(next);
    ttsRateRef.current = next;
    const a = ttsAudioRef.current;
    if (a) {
      a.defaultPlaybackRate = next;
      a.playbackRate = next;
    }
    if (settingsView) saveSettings({ ttsRate: next });
  };
  // 启动时从设置恢复朗读倍速
  useEffect(() => {
    const r = settingsView?.ttsRate;
    if (r && r !== ttsRateRef.current) {
      setTtsRate(r);
      ttsRateRef.current = r;
    }
  }, [settingsView]);

  /** 归档/撤销归档当前单集;归档后自动选中未读视图的下一条 */
  const toggleRead = async () => {
    if (!ep) return;
    const archiving = !ep.readAt;
    const idx = visible.findIndex((e) => e.id === ep.id);
    await api.setRead(ep.id, archiving);
    await refresh();
    if (archiving && !showArchived && idx >= 0) {
      const next = visible[idx + 1] ?? visible[idx - 1];
      if (next) setActiveId(next.id);
    }
  };

  // ===== 真实播放引擎:<audio> + asset 协议 + Web Audio 波形峰值 =====
  const audioInfoRef = useRef({});
  useEffect(() => { audioInfoRef.current = audioInfo; }, [audioInfo]);
  const registerAudio = useCallback(async (id, path) => {
    const url = await toMediaUrl(path);
    setAudioInfo((m) => ({ ...m, [id]: { url, peaks: m[id]?.peaks ?? null } }));
    if (!audioInfoRef.current[id]?.peaks) {
      extractPeaks(url)
        .then((peaks) => {
          setAudioInfo((m) => ({ ...m, [id]: { ...(m[id] ?? { url }), peaks } }));
          api.savePeaks(id, peaks).catch(() => {}); // 持久化,重启秒显真波形
        })
        .catch(() => {}); // 解码失败只影响波形观感,不影响播放
    }
    return url;
  }, []);

  // 选中已完成剧集时:峰值缓存先行(秒显真波形),已下载过的音频直接注册(秒播就绪)
  useEffect(() => {
    if (!activeId || audioInfo[activeId]) return;
    const r = records.find((x) => x.id === activeId);
    if (r?.status !== "ready") return;
    api.getPeaks(activeId).then((peaks) => {
      if (peaks?.length) {
        setAudioInfo((m) => (m[activeId]?.peaks ? m : { ...m, [activeId]: { url: m[activeId]?.url ?? null, peaks } }));
      }
    }).catch(() => {});
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
    ttsAudioRef.current?.pause(); // 播客原声与朗读互斥
    let info = audioInfo[ep.id];
    if (!info?.url) {
      // 首次播放:先把音频拉到本地(峰值缓存可能已就位但没有音频)
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

  // 回车/空格 = 播放/暂停,E = 归档(窗口激活、不在输入框/按钮/弹窗/设置页时)
  const togglePlayRef = useRef(() => {});
  useEffect(() => { togglePlayRef.current = togglePlay; });
  const toggleReadRef = useRef(() => {});
  useEffect(() => { toggleReadRef.current = toggleRead; });
  useEffect(() => {
    if (adding || view !== "notes") return;
    const onKey = (e) => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "e" && e.key !== "E") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
      e.preventDefault(); // 空格默认滚动页面
      if (e.key === "e" || e.key === "E") toggleReadRef.current();
      else togglePlayRef.current();
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
      llmApi: next.llmApi || "openai-responses",
      llmModel: next.llmModel,
      notesDir: next.notesDir ?? null,
      subAuto: next.subAuto ?? true,
      ttsVoice: next.ttsVoice || "Cherry",
      ttsRate: next.ttsRate ?? 1.5,
      exportWikilinks: next.exportWikilinks ?? false,
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
  const saveKeys = async ({ asrKey, llmKey, tavilyKey }) => {
    await api.setKeys(asrKey, llmKey, tavilyKey);
    refreshSettings();
  };
  const chooseDir = async () => {
    if (!inTauri) return saveSettings({ notesDir: "/mock/笔记库" }); // mock 模式没有原生对话框
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true });
    if (dir) saveSettings({ notesDir: dir });
  };

  return (
    <div style={{
      position: "relative", width: "100%", height: "100%",
      display: "flex", boxSizing: "border-box",
      padding: "var(--frame-pad)", gap: "var(--frame-pad)",
    }}>
      {view === "settings" ? (
        settingsView && (
          <div className="pn-unit" style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden" }}>
            <Settings
              view={settingsView}
              onChangeField={saveSettings}
              onSaveKeys={saveKeys}
              onChooseDir={chooseDir}
              onTestAsr={() => api.testAsrKey()}
              onTestLlm={() => api.testLlm()}
              onTestTavily={() => api.testTavily()}
              subsCount={subs.length}
              onGoSubs={() => setView("subs")}
              onBack={() => setView("notes")}
            />
          </div>
        )
      ) : view === "subs" ? (
        <div className="pn-unit" style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden" }}>
          <Subscriptions
            subs={subs}
            auto={!!settingsView?.subAuto}
            onAdd={addSub}
            onRemove={removeSub}
            onCheck={checkSubs}
            onBack={() => setView("notes")}
          />
        </div>
      ) : (
        <>
          <Rack
            episodes={visible}
            shows={shows}
            filterShow={filterShow}
            onFilterShow={applyFilter}
            archivedCount={archivedCount}
            unreadCount={unreadCount}
            showArchived={showArchived}
            onToggleArchived={toggleArchivedView}
            activeId={activeId}
            onSelect={(id) => {
              audioRef.current?.pause();
              ttsAudioRef.current?.pause();
              ttsWantRef.current = null;
              setTtsWaiting(false);
              setTtsIdx(-1);
              setActiveId(id);
              setPlayFrac(0);
              setDlPct(null);
            }}
            onAdd={() => { setAdding(true); setAddAct("input"); setAddErr(""); }}
            onSubs={() => setView("subs")}
            onSettings={() => setView("settings")}
            onExportEpisode={(id) => api.exportEpisode(id)}
            onExportShow={(show) => api.exportShow(show)}
          />
          <div className="pn-unit" style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden", position: "relative" }}>
          {episodes.length === 0 ? (
            <Empty
              selfCheck={{
                asrKey: !!settingsView?.asrKeySet,
                llmKey: !!settingsView?.llmKeySet,
                llmGateway: !!(settingsView?.llmBaseUrl && settingsView?.llmModel),
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
              onToggleRead={toggleRead}
              corrections={correctionsMap[ep?.id] ?? []}
              qaApi={ep ? {
                get: () => api.getQa(ep.id),
                ask: (q, history, onEvent) => api.askEpisode(ep.id, q, history, onEvent),
                cancel: () => api.cancelAsk(ep.id),
              } : undefined}
              onResearchTerm={(term, context) => api.researchTerm(ep.id, term, context)}
              onResearchBlocks={(reqId, blocks, onEvent) => api.researchBlocks(ep.id, reqId, blocks, onEvent)}
              onCancelResearch={(reqId) => api.cancelResearch(reqId)}
              onApplyCorrection={async (original, corrected, evidenceUrl, confidence) => {
                if (!ep) return 0;
                const n = await api.applyCorrection(ep.id, original, corrected, evidenceUrl, confidence);
                // 笔记与字幕都变了:旧朗读与旧字幕缓存作废,重拉笔记与纠正记录
                ttsAudioRef.current?.pause();
                setTtsInfo((m) => { const x = { ...m }; delete x[ep.id]; return x; });
                setTranscripts((m) => { const x = { ...m }; delete x[ep.id]; return x; });
                await loadNote(ep.id);
                return n;
              }}
              onRegenerateNote={() => {
                if (!ep) return;
                ttsAudioRef.current?.pause();
                setTtsInfo((m) => { const n = { ...m }; delete n[ep.id]; return n; }); // 旧朗读作废
                api.regenerate(ep.id).then(refresh);
              }}
              onRegenerateTranscript={() => {
                if (!ep) return;
                ttsAudioRef.current?.pause();
                setTtsInfo((m) => { const n = { ...m }; delete n[ep.id]; return n; });
                setTranscripts((m) => { const n = { ...m }; delete n[ep.id]; return n; }); // 旧字幕作废
                api.regenerateTranscript(ep.id).then(refresh);
              }}
              tts={{
                playing: ttsPlaying && ttsEpId === ep?.id,
                waiting: ttsWaiting && ttsEpId === ep?.id,
                gen: ttsGen[ep?.id] ?? null,
                rate: ttsRate,
              }}
              ttsSeg={
                ttsEpId === ep?.id && ttsIdx >= 0 && (ttsPlaying || ttsWaiting)
                  ? ttsInfo[ep?.id]?.segments?.[ttsIdx]?.key ?? null
                  : null
              }
              onToggleTts={toggleTts}
              onCycleTtsRate={cycleTtsRate}
              onRetry={() => ep && api.retry(ep.id)}
              onGoSettings={() => setView("settings")}
            />
          )}
          </div>
        </>
      )}
      <audio
        ref={ttsAudioRef}
        style={{ display: "none" }}
        onPlay={(e) => { setTtsPlaying(true); e.currentTarget.playbackRate = ttsRateRef.current; }}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = ttsRateRef.current; }}
        onError={(e) => {
          // 音频加载/解码失败(如 asset 协议拦截):显式亮错,不静默装死
          const id = e.currentTarget.dataset.epid;
          if (!id) return;
          e.currentTarget.removeAttribute("src");
          delete e.currentTarget.dataset.epid;
          ttsWantRef.current = null;
          setTtsWaiting(false);
          setTtsPlaying(false);
          setTtsIdx(-1);
          setTtsGen((m) => ({ ...m, [id]: { error: "朗读音频加载失败" } }));
        }}
        onPause={() => setTtsPlaying(false)}
        onEnded={(e) => {
          // 一段播完接下一段;还没落盘就挂起等 segment 事件
          const a = e.currentTarget;
          const id = a.dataset.epid;
          const seq = Number(a.dataset.seq ?? -1);
          const info = ttsInfoRef.current[id];
          const next = seq + 1;
          if (!info || next >= info.segments.length) {
            setTtsPlaying(false);
            setTtsIdx(-1);
            return;
          }
          playSegRef.current(id, next, info.segments[next]?.url ?? null);
        }}
      />
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
  // 浏览器 + ?mock=1:LiveApp 跑内存假后端,全流程交互自测
  return inTauri || mockMode ? <LiveApp /> : <DemoApp />;
}
