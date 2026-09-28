/** Nettoie les liens copiés depuis Discord, y compris les liens Markdown. */
function cleanMediaQuery(input) {
  let query = String(input || '').trim().replace(/\\([&_*])/g, '$1');
  const markdownLink = query.match(/\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\s*\)/i);
  if (markdownLink) query = markdownLink[1];
  else {
    const angleLink = query.match(/<\s*(https?:\/\/[^>]+)\s*>/i);
    if (angleLink) query = angleLink[1];
  }

  const youtubeLink = query.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s)>]+/i);
  if (youtubeLink) {
    const rawUrl = youtubeLink[0].replace(/\\([&_*])/g, '$1');
    try {
      const parsed = new URL(rawUrl);
      let videoId = parsed.hostname.toLowerCase().endsWith('youtu.be')
        ? parsed.pathname.split('/').filter(Boolean)[0]
        : parsed.searchParams.get('v');
      if (!videoId) {
        const pathMatch = parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/i);
        videoId = pathMatch && pathMatch[1];
      }
      if (videoId && /^[\w-]{11}$/.test(videoId)) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    } catch (_) { /* conserve la requête brute pour que resolveQuery la refuse */ }
    return rawUrl;
  }

  const spotifyLink = query.match(/https?:\/\/(?:open\.)?spotify\.com\/[^\s)>]+/i);
  if (spotifyLink) return spotifyLink[0].replace(/\\([&_*])/g, '$1');
  return query;
}

module.exports = { cleanMediaQuery };
