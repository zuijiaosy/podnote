// Podnote 主窗口 — P0:静态还原(fixtures 数据),P2 接 Rust commands/events
import { useEffect, useRef, useState } from "react";
import { Rack } from "./screens/Rack.jsx";
import { NoteView } from "./screens/NoteView.jsx";
import { Empty } from "./screens/Empty.jsx";
import { AddFlow, useDemoStages } from "./screens/AddFlow.jsx";
import { Settings } from "./screens/Settings.jsx";
import { EPISODES } from "./lib/fixtures.js";

export default function App() {
  const [episodes] = useState(EPISODES);
  const [view, setView] = useState("notes"); // notes | settings
  const [activeId, setActiveId] = useState(episodes[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [addAct, setAddAct] = useState("input");
  const [addUrl, setAddUrl] = useState("");
  const [playFrac, setPlayFrac] = useState(0.32);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [settings, setSettings] = useState({
    asrKey: "", llmKey: "",
    llmModelMode: "GROK-4.5", llmModelCustom: "",
    notesDir: "~/Documents/Podnote",
  });
  const demoStages = useDemoStages();

  const ep = episodes.find((e) => e.id === activeId) ?? null;

  // P0 播放模拟:500ms 机械跳步(P3 换 <audio> 真实播放)
  const tick = useRef(null);
  useEffect(() => {
    if (!playing || !ep) return;
    tick.current = setInterval(() => {
      setPlayFrac((f) => {
        const next = f + (0.5 * speed) / ep.durationSec;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
    }, 500);
    return () => clearInterval(tick.current);
  }, [playing, speed, ep?.id]);

  const selectEpisode = (id) => {
    setActiveId(id);
    setPlaying(false);
    setPlayFrac(0);
  };

  return (
    <div style={{
      position: "relative", width: "100%", height: "100%",
      display: "flex", gap: 16, padding: 16, boxSizing: "border-box",
    }}>
      {view === "settings" ? (
        <Settings
          settings={settings}
          onChange={setSettings}
          onBack={() => setView("notes")}
          onChooseDir={() => {}}
        />
      ) : (
        <>
          <Rack
            episodes={episodes}
            activeId={activeId}
            onSelect={selectEpisode}
            onAdd={() => { setAdding(true); setAddAct("input"); }}
            onSettings={() => setView("settings")}
          />
          {episodes.length === 0 ? (
            <Empty
              selfCheck={{ asrKey: !!settings.asrKey, llmKey: !!settings.llmKey }}
              onAdd={() => { setAdding(true); setAddAct("input"); }}
              onGoSettings={() => setView("settings")}
            />
          ) : (
            <NoteView
              ep={ep}
              playFrac={playFrac} playing={playing} speed={speed}
              onTogglePlay={() => setPlaying((p) => !p)}
              onSeekFrac={(f) => setPlayFrac(f)}
              onCycleSpeed={() => setSpeed((v) => ({ 1: 1.5, 1.5: 2, 2: 1 }[v]))}
              onRetry={() => {}}
              onGoSettings={() => setView("settings")}
            />
          )}
        </>
      )}
      {adding && (
        <AddFlow
          act={addAct}
          stages={demoStages}
          url={addUrl}
          onUrlChange={setAddUrl}
          onStart={() => setAddAct("run")}
          onEditUrl={() => setAddAct("input")}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
