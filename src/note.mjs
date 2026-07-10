// note.mjs — 笔记数据结构:解析 LLM 输出的 JSON + 渲染成 Markdown
// schema 与设计稿(Podnote 正式设计 standalone.html)的 view-model 对齐:
// { speakers:{S1:名}, tldr, points:[{t,ts,who,h,body}], quotes:[{t,ts,who,text}],
//   resources:[{name,note}], questions:[] }
// t(秒)由 ts 解析而来,波形锚点 = t / durationSec;who 来自说话人分离+开场映射

const REQUIRED = ["tldr", "points", "quotes", "resources", "questions"];

export function tsToSeconds(ts) {
  return String(ts)
    .split(":")
    .reduce((acc, n) => acc * 60 + Number(n), 0);
}

export function parseNote(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw Object.assign(new Error("LLM 输出里没找到 JSON 对象"), { raw });
  }
  let note;
  try {
    note = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw Object.assign(new Error(`笔记 JSON 解析失败: ${e.message}`), { raw });
  }
  for (const k of REQUIRED) {
    if (!(k in note)) {
      throw Object.assign(new Error(`笔记 JSON 缺少字段: ${k}`), { raw });
    }
  }
  for (const p of note.points) p.t = tsToSeconds(p.ts);
  for (const q of note.quotes) q.t = tsToSeconds(q.ts);
  return note;
}

export function noteToMarkdown(meta, note) {
  const L = [];
  L.push(`# ${meta.title}`, "");
  L.push(`> ${note.tldr}`, "");
  L.push("## 核心观点", "");
  for (const p of note.points) {
    L.push(`### ${p.h}${p.who ? ` · ${p.who}` : ""} (${p.ts})`, "", p.body, "");
  }
  L.push("## 值得记住的话", "");
  for (const q of note.quotes) {
    L.push(`> 「${q.text}」${q.who ? `—— ${q.who} ` : ""}(${q.ts})`, "");
  }
  L.push("## 提到的资源", "");
  L.push(
    note.resources.length
      ? note.resources.map((r) => `- **${r.name}** — ${r.note}`).join("\n")
      : "无",
    ""
  );
  L.push("## 我可能想深挖的", "");
  note.questions.forEach((q, i) => L.push(`${i + 1}. ${q}`));
  L.push("", "---", `节目: ${meta.podcast}`, `原始链接: ${meta.url}`);
  return L.join("\n") + "\n";
}
