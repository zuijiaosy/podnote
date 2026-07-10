// audio — Web Audio 解码音频提取波形峰值(真实振幅,替代占位伪随机)
export async function extractPeaks(assetUrl, n = 110) {
  const buf = await (await fetch(assetUrl)).arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const block = Math.floor(data.length / n);
    const peaks = [];
    for (let i = 0; i < n; i++) {
      let max = 0;
      const start = i * block;
      // 稀疏采样:一小时音频全量扫太慢,每 32 个采一点足够画 3px 宽的条
      for (let j = 0; j < block; j += 32) {
        const v = Math.abs(data[start + j] || 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const top = Math.max(...peaks, 0.01);
    return peaks.map((p) => 0.15 + (p / top) * 0.85);
  } finally {
    ctx.close();
  }
}
