// 空状态(首次启动):自检灯 + 大圆钮 onboarding
// 自检灯是设计评审补差项:仪器开机先自检,缺什么亮什么
import { Button } from "../components/core.jsx";
import { StatusLabel, IndicatorLight } from "../components/instrument.jsx";

export function Empty({ selfCheck = { asrKey: false, llmKey: false, llmGateway: false }, onAdd, onGoSettings }) {
  const allReady = selfCheck.asrKey && selfCheck.llmKey && selfCheck.llmGateway;
  return (
    <div style={{
      flex: 1, minWidth: 0, background: "var(--well)", borderRadius: "var(--radius)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32,
    }}>
      <div style={{ display: "flex", gap: 24 }}>
        <IndicatorLight status={selfCheck.asrKey ? "ready" : "error"} label="转写密钥" />
        <IndicatorLight status={selfCheck.llmKey ? "ready" : "error"} label="笔记密钥" />
        <IndicatorLight status={selfCheck.llmGateway ? "ready" : "error"} label="笔记网关" />
      </div>
      {allReady ? (
        <>
          <Button variant="knob" size="lg" onClick={onAdd} aria-label="添加第一集">开始</Button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-lg)", color: "var(--ink)" }}>
              粘贴一个小宇宙链接,开始。
            </span>
            <StatusLabel tone="dim">支持小宇宙单集链接</StatusLabel>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, maxWidth: 380, textAlign: "center" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-lg)", color: "var(--ink)" }}>
              先配好钥匙和网关,仪器才能开机。
            </span>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--scale)", lineHeight: "var(--leading-note)" }}>
              转写走阿里百炼,笔记走你自己指定的 LLM 网关。密钥只存在本机。
            </span>
          </div>
          <Button variant="secondary" onClick={onGoSettings}>去设置</Button>
        </>
      )}
    </div>
  );
}
