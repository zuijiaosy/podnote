// 空状态(首次启动):自检灯 + 大圆钮 onboarding
// 自检灯是设计评审补差项:仪器开机先自检,缺什么亮什么
import { Button } from "../components/core.jsx";
import { StatusLabel, IndicatorLight } from "../components/instrument.jsx";

export function Empty({ selfCheck = { asrKey: false, llmKey: false }, onAdd, onGoSettings }) {
  const allReady = selfCheck.asrKey && selfCheck.llmKey;
  return (
    <div style={{
      flex: 1, minWidth: 0, background: "var(--well)", borderRadius: "var(--radius)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32,
    }}>
      <div style={{ display: "flex", gap: 24 }}>
        <IndicatorLight status={selfCheck.asrKey ? "ready" : "error"} label="ASR KEY" />
        <IndicatorLight status={selfCheck.llmKey ? "ready" : "error"} label="LLM KEY" />
      </div>
      {allReady ? (
        <>
          <Button variant="knob" size="lg" onClick={onAdd} aria-label="添加第一集">GO</Button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-lg)", color: "var(--ink)" }}>
              粘贴一个小宇宙链接,开始。
            </span>
            <StatusLabel tone="dim">PASTE XIAOYUZHOU EPISODE URL</StatusLabel>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, maxWidth: 380, textAlign: "center" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-lg)", color: "var(--ink)" }}>
              先配好两把钥匙,仪器才能开机。
            </span>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)", lineHeight: "var(--leading-note)" }}>
              转写走阿里百炼,笔记走你的 LLM 网关。密钥只存在本机钥匙串。
            </span>
          </div>
          <Button variant="secondary" onClick={onGoSettings}>GO TO SETTINGS</Button>
        </>
      )}
    </div>
  );
}
