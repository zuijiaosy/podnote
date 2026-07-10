// resolve.mjs — 小宇宙单集页面 → 音频地址 + 元信息
// 用法: node src/resolve.mjs <episode_url>

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export async function resolveEpisode(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`页面请求失败: ${res.status}`);
  const html = await res.text();

  // 路线 1: og:audio meta 标签
  let audioUrl = html.match(
    /<meta[^>]+property="og:audio"[^>]+content="([^"]+)"/
  )?.[1];

  // 路线 2: __NEXT_DATA__ 里的 enclosure / media
  let nextData = null;
  const nextMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (nextMatch) {
    try {
      nextData = JSON.parse(nextMatch[1]);
    } catch {
      /* 页面结构变了也不至于崩 */
    }
  }
  const episode =
    nextData?.props?.pageProps?.episode ??
    nextData?.props?.pageProps?.data ??
    null;

  if (!audioUrl) {
    audioUrl =
      episode?.enclosure?.url ??
      episode?.media?.source?.url ??
      html.match(/https:\/\/media\.xyzcdn\.net\/[^"'\s]+\.(?:m4a|mp3)/)?.[0];
  }
  if (!audioUrl) {
    throw new Error(
      "没解析出音频地址——小宇宙页面结构可能变了,把页面 HTML 存下来发给 AI 重新定位字段即可"
    );
  }

  const title =
    episode?.title ??
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)?.[1] ??
    "untitled";
  const podcast = episode?.podcast?.title ?? "";
  const shownotes = (episode?.shownotes ?? episode?.description ?? "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const duration = episode?.duration ?? null; // 秒

  return { url, audioUrl, title, podcast, shownotes, duration };
}

// 直接运行时打印结果
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("用法: node src/resolve.mjs <小宇宙单集链接>");
    process.exit(1);
  }
  resolveEpisode(url).then(
    (r) => console.log(JSON.stringify(r, null, 2)),
    (e) => {
      console.error(e.message);
      process.exit(1);
    }
  );
}
