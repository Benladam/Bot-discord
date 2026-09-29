const MAX_CHOICES = 25;
const WORLD_CHART_FALLBACK_VALUE = 'music-chart:world-top';

function formatDuration(value) {
  const seconds = Math.floor(Number(value) || 0);
  if (seconds < 1) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return `${String(minutes).padStart(2, '0')}:${remainder}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
}

function cleanArtist(value) {
  const artist = String(value || '').split('·')[0].replace(/https?:\/\/\S+/gi, '').replace(/\s+-\s+Topic$/i, '').trim();
  return artist;
}

function formatChoiceName(item) {
  const rawTitle = String(item.title || 'Sans titre').trim();
  const title = rawTitle.replace(/https?:\/\/\S+/gi, '').trim() || 'Morceau sans titre';
  const subtitle = String(item.subtitle || '').replace(/https?:\/\/\S+/gi, '').trim();
  if (item.kind === 'track') {
    const artist = cleanArtist(item.subtitle);
    const hasArtist = artist && title.toLocaleLowerCase().includes(artist.toLocaleLowerCase());
    const track = artist && !hasArtist ? `${artist} - ${title}` : title;
    const duration = formatDuration(item.duration);
    const chartRank = item.worldChart && item.chartPosition ? `🌍 #${item.chartPosition} · ` : '';
    return `${chartRank}🎵 ${track}${duration ? ` - ${duration}` : ''}`;
  }
  if (item.kind === 'playlist') {
    return `📁 ${title}${subtitle ? ` · ${subtitle}` : ''}`;
  }
  if (item.kind === 'album') {
    return `💿 ${title}${subtitle ? ` · ${subtitle}` : ''}`;
  }
  if (item.kind === 'artist') return `👤 ${title} · discographie`;
  return `🎶 ${title}`;
}

function trimChoiceName(value) {
  let result = '';
  for (const character of String(value)) {
    if (result.length + character.length > 100) break;
    result += character;
  }
  return result;
}

function selectAutocompleteItems(items, limit = MAX_CHOICES) {
  const valid = items.filter((item) => item?.url && String(item.url).length <= 100);
  const count = Math.max(0, Math.min(MAX_CHOICES, limit));
  const tracks = valid.filter((item) => item.kind === 'track');
  const playlists = valid.filter((item) => item.kind === 'playlist');
  const others = valid.filter((item) => item.kind !== 'track' && item.kind !== 'playlist');
  const selected = [
    ...tracks.slice(0, 15),
    ...playlists.slice(0, 8),
    ...others.slice(0, 2),
  ].slice(0, count);
  const selectedUrls = new Set(selected.map((item) => item.url));

  const fillOrder = [...playlists.slice(8), ...others.slice(2), ...tracks.slice(15)];
  for (const item of fillOrder) {
    if (selected.length >= count) break;
    if (!selectedUrls.has(item.url)) {
      selected.push(item);
      selectedUrls.add(item.url);
    }
  }
  return selected;
}

function toAutocompleteChoice(item) {
  return {
    name: trimChoiceName(formatChoiceName(item)),
    value: String(item.url),
  };
}

function toSearchFallbackChoice(query, { worldChart = false } = {}) {
  const rawValue = String(worldChart ? 'top mondial' : query).trim();
  const value = worldChart
    ? WORLD_CHART_FALLBACK_VALUE
    : (/^https?:\/\//i.test(rawValue) ? 'lien musical' : rawValue).slice(0, 100) || 'recherche';
  const name = worldChart
    ? '🌍 Rechercher « Top mondial »'
    : `🔎 Rechercher « ${value} »`;
  return { name: trimChoiceName(name), value };
}

module.exports = {
  formatDuration,
  formatChoiceName,
  selectAutocompleteItems,
  toAutocompleteChoice,
  toSearchFallbackChoice,
  WORLD_CHART_FALLBACK_VALUE,
};
