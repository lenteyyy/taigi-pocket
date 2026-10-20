// Made By 冷踢踢。只正規化搜尋鍵，原始詞目與釋義不作繁簡改寫。
export function createSearchTools(data = {}) {
  const characters = data.characters || {};
  const cache = new Map();
  const normalizeHan = (value) => {
    const text = String(value ?? '');
    if (cache.has(text)) return cache.get(text);
    const normalized = Array.from(text, (ch) => characters[ch] || ch).join('');
    if (cache.size >= 200000) cache.clear();
    cache.set(text, normalized);
    return normalized;
  };
  const aliases = new Map();
  for (const group of data.aliases || []) {
    if (!Number.isSafeInteger(group.entryId) || group.entryId <= 0) continue;
    for (const term of group.terms || []) {
      const key = normalizeHan(term);
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key).add(group.entryId);
    }
  }
  return {
    normalizeHan,
    aliasIDs(query, mode) {
      if (mode === 'wildcard' && /[*?]/.test(query)) return [];
      return [...(aliases.get(normalizeHan(query)) || [])];
    },
  };
}
