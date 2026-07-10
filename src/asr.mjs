// asr.mjs — 云端转写:百炼 fun-asr 异步 API,自带说话人分离
// 音频不落地:直接把小宇宙的公网音频 URL 交给 API
// 环境变量: BAILIAN_API_KEY(必填), BAILIAN_HOST(专属网关地址)

const HOST =
  process.env.BAILIAN_HOST ||
  "https://llm-xy8sn8964kplkx1s.cn-beijing.maas.aliyuncs.com";
const KEY = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;

async function api(path, init = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`ASR API ${res.status}: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

export async function transcribe(audioUrl) {
  if (!KEY) throw new Error("缺少 BAILIAN_API_KEY");

  const submitted = await api("/api/v1/services/audio/asr/transcription", {
    method: "POST",
    headers: { "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model: "fun-asr",
      input: { file_urls: [audioUrl] },
      parameters: { diarization_enabled: true, language_hints: ["zh"] },
    }),
  });
  const taskId = submitted.output?.task_id;
  if (!taskId) throw new Error(`提交转写任务失败: ${JSON.stringify(submitted)}`);
  console.log(`[asr] 任务已提交 ${taskId},云端转写中(一小时音频约 3-5 分钟)...`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 15000));
    const data = await api(`/api/v1/tasks/${taskId}`);
    const st = data.output?.task_status;
    process.stdout.write(`\r[asr] ${st}   `);
    if (st === "SUCCEEDED") {
      process.stdout.write("\n");
      const url = data.output.results?.[0]?.transcription_url;
      if (!url) throw new Error(`任务成功但没有结果地址: ${JSON.stringify(data.output)}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下载转写结果失败: ${res.status}`);
      return await res.json();
    }
    if (st === "FAILED" || st === "UNKNOWN") {
      process.stdout.write("\n");
      throw new Error(
        `转写任务失败: ${data.output?.message || JSON.stringify(data.output)}`
      );
    }
  }
}

// 转写结果 → 带时间戳和说话人标签的文本行,喂给 LLM
// speaker_id 0/1/2 → S1/S2/S3(与 prompts/note.md 的约定一致)
export function toTimedText(result) {
  const sents = result.transcripts?.[0]?.sentences ?? [];
  const lines = [];
  for (const s of sents) {
    const t = Math.floor(s.begin_time / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = t % 60;
    const p = (n) => String(n).padStart(2, "0");
    const ts = h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
    const spk = s.speaker_id != null ? `S${s.speaker_id + 1}` : "S?";
    lines.push(`[${ts}] ${spk}: ${s.text.trim()}`);
  }
  return lines.join("\n");
}
