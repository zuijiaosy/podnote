// DemoApp — 浏览器设计评审模式:fixtures 数据 + 模拟交互(不依赖 Tauri)
import { useEffect, useRef, useState } from "react";
import { Rack } from "./Rack.jsx";
import { NoteView } from "./NoteView.jsx";
import { AddFlow, useDemoStages } from "./AddFlow.jsx";
import { Settings } from "./Settings.jsx";
import { EPISODES, DEMO_PEAKS } from "../lib/fixtures.js";

export function DemoApp() {
  const [episodes] = useState(EPISODES);
  const [view, setView] = useState("notes");
  const [activeId, setActiveId] = useState(episodes[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [addAct, setAddAct] = useState("input");
  const [addUrl, setAddUrl] = useState("");
  const [playFrac, setPlayFrac] = useState(0.32);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const demoStages = useDemoStages();

  const ep = episodes.find((e) => e.id === activeId) ?? null;

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

  return (
    <div style={{
      position: "relative", width: "100%", height: "100%",
      display: "flex", gap: 16, padding: 16, boxSizing: "border-box",
    }}>
      {view === "settings" ? (
        <Settings
          view={{
            llmBaseUrl: "", llmModel: "", notesDir: "~/Documents/Podnote",
            asrKeySet: true, asrKeyHint: "k3f8", llmKeySet: false, tavilyKeySet: false, subAuto: true,
          }}
          onChangeField={() => {}}
          onSaveKeys={() => {}}
          onChooseDir={() => {}}
          onTestAsr={() => new Promise((r) => setTimeout(r, 900))}
          onTestLlm={() => new Promise((_, j) => setTimeout(() => j("缺少 LLM API Key"), 1300))}
          subsCount={1}
          onGoSubs={() => {}}
          onBack={() => setView("notes")}
        />
      ) : (
        <>
          <Rack
            episodes={episodes}
            activeId={activeId}
            onSelect={(id) => { setActiveId(id); setPlaying(false); setPlayFrac(0); }}
            onAdd={() => { setAdding(true); setAddAct("input"); }}
            onSettings={() => setView("settings")}
          />
          <NoteView
            ep={ep}
            playFrac={playFrac} playing={playing} speed={speed}
            bars={DEMO_PEAKS}
            onTogglePlay={() => setPlaying((p) => !p)}
            onSeekFrac={setPlayFrac}
            onCycleSpeed={() => setSpeed((v) => ({ 1: 1.5, 1.5: 2, 2: 1 }[v]))}
            onRetry={() => {}}
            onGoSettings={() => setView("settings")}
          />
        </>
      )}
      {adding && (
        <AddFlow
          act={addAct} stages={demoStages} url={addUrl}
          onUrlChange={setAddUrl}
          onStart={() => setAddAct("run")}
          onEditUrl={() => setAddAct("input")}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
