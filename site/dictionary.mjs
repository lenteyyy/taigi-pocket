import { normalizeRoman, numberToTone } from './core.mjs';
import { createSearchTools } from './search.mjs';

// Made By 冷踢踢
const BRIEF =
  'SELECT e.*, (SELECT definition FROM sense s WHERE s.entry_id=e.id ORDER BY sense_order LIMIT 1) AS definition FROM entry e ';
export function rows(db, sql, params = {}) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(
      Array.isArray(params)
        ? params
        : Object.fromEntries(Object.entries(params).map(([k, v]) => [':' + k, v])),
    );
    const result = [];
    while (stmt.step()) result.push(stmt.getAsObject());
    return result;
  } finally {
    stmt.free();
  }
}
export function pattern(query, mode) {
  const text = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return mode === 'wildcard'
    ? text.replace(/\*/g, '%').replace(/\?/g, '_')
    : mode === 'suffix'
      ? '%' + text
      : mode === 'contains'
        ? '%' + text + '%'
        : mode === 'exact'
          ? text
          : text + '%';
}
const brief = (row, source = 'moe') =>
  source === 'soannteng'
    ? {
        id: row.id,
        source,
        hanji: row.hanji,
        tailo: row.tailo || row.poj || '',
        definition: row.hoabun || '',
        marker: null,
        audio: false,
      }
    : {
        id: row.id,
        source,
        hanji: row.hanji_raw,
        tailo: (row.tailo_raw || '').replace(/【[^】]+】/g, ''),
        definition: row.definition || '',
        marker: row.tailo_marker,
        audio: !!row.audio_basename,
      };
const positiveID = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('詞目編號不正確。');
  return id;
};
export function createDictionary({
  loadDatabase,
  courseMap,
  soundExamples,
  exampleAudio,
  audioCatalog = { files: {} },
  searchData = {},
}) {
  const entryCache = new Map();
  const searchTools = createSearchTools(searchData);
  const searchable = new WeakSet();
  const prepareSearch = (db) => {
    if (!searchable.has(db)) {
      db.create_function('search_han', searchTools.normalizeHan);
      searchable.add(db);
    }
    return db;
  };
  let lexicon = null;
  async function getEntry(id, source = 'moe') {
    if (!['moe', 'soannteng'].includes(source)) throw new Error('資料來源不正確。');
    id = positiveID(id);
    const key = source + ':' + id;
    if (entryCache.has(key)) return entryCache.get(key);
    const db = await loadDatabase(source);
    const row = rows(db, 'SELECT * FROM entry WHERE id=?', [id])[0];
    if (!row) throw new Error('找不到這個詞目。');
    const e = brief(row, source);
    e.senses = [];
    e.readings = [];
    e.variants = [];
    e.alternates = [];
    e.relations = [];
    e.dialects = [];
    e.categories = [];
    e.accentVariants = [];
    if (source === 'soannteng') {
      e.poj = row.poj;
      e.senses = [{ definition: row.hoabun || '', pos: '', examples: [] }];
    } else {
      e.readings = rows(db, 'SELECT tailo FROM reading WHERE entry_id=? ORDER BY reading_order', [
        id,
      ]).map((x) => x.tailo);
      e.senses = rows(db, 'SELECT * FROM sense WHERE entry_id=? ORDER BY sense_order', [id]).map(
        (s) => ({
          id: s.id,
          pos: s.pos,
          definition: s.definition,
          examples: rows(
            db,
            'SELECT id,hanji,tailo,huagi,audio_basename FROM example WHERE sense_id=? ORDER BY example_order',
            [s.id],
          ),
        }),
      );
      e.definition = e.senses[0]?.definition || '';
      e.variants = rows(db, 'SELECT variant FROM variant_char WHERE entry_id=?', [id]).map(
        (x) => x.variant,
      );
      e.alternates = rows(
        db,
        'SELECT alt_type,hanji,tailo_raw FROM alt_pronunciation WHERE entry_id=?',
        [id],
      );
      const relations = rows(
        db,
        "SELECT sr.* FROM semantic_relation sr WHERE (sr.source_kind='entry' AND sr.source_id=?) OR (sr.source_kind='sense' AND sr.source_id IN(SELECT id FROM sense WHERE entry_id=?))",
        [id, id],
      );
      for (const relation of relations) {
        const target =
          relation.target_kind === 'sense'
            ? rows(db, 'SELECT entry_id FROM sense WHERE id=?', [relation.target_id])[0]?.entry_id
            : relation.target_id;
        if (!target) continue;
        const word = rows(
          db,
          'SELECT id,hanji_raw AS hanji,tailo_raw AS tailo FROM entry WHERE id=?',
          [target],
        )[0];
        if (word) e.relations.push({ type: relation.relation_type, ...word });
      }
      e.relations.push(
        ...rows(
          db,
          "SELECT 'related' AS type,e.id,e.hanji_raw AS hanji,e.tailo_raw AS tailo FROM cross_reference cr JOIN entry e ON e.id=cr.related_entry_id WHERE cr.entry_id=?",
          [id],
        ),
      );
      e.relations = [...new Map(e.relations.map((r) => [r.type + ':' + r.id, r])).values()];
      e.categories = rows(
        db,
        'SELECT cm.id,cm.name FROM entry_category ec JOIN category_minor cm ON cm.id=ec.minor_id WHERE ec.entry_id=?',
        [id],
      );
      e.dialects = rows(
        db,
        'SELECT accent,hanji,tailo_raw,huagi_term FROM dialect_comparison WHERE huagi_entry_id IN(SELECT huagi_entry_id FROM dialect_comparison_link WHERE entry_id=?)',
        [id],
      );
      e.accentVariants = rows(
        db,
        'SELECT hanji,accent_region,tailo_raw FROM accent_variant WHERE entry_id=?',
        [id],
      );
    }
    entryCache.set(key, e);
    return e;
  }
  async function search(q) {
    const mode = q.get('mode') || 'prefix';
    if (!['prefix', 'contains', 'suffix', 'wildcard', 'exact'].includes(mode))
      throw new Error('搜尋模式不正確。');
    const query = (q.get('q') || '').trim().slice(0, 150),
      category = q.get('category') || '';
    const offset = Math.max(0, Math.min(1000000, Math.floor(Number(q.get('offset')) || 0)));
    const normalized = searchTools.normalizeHan(query);
    const aliasIDs = searchTools.aliasIDs(query, mode);
    const params = {
      h: pattern(normalized, mode),
      r: pattern(normalizeRoman(query), mode),
      q: normalized,
      raw: query,
      romanExact: numberToTone(query),
      limit: 70,
      offset,
    };
    const aliasCondition = aliasIDs.length
      ? `e.id IN (${aliasIDs
          .map((id, i) => {
            params['alias' + i] = id;
            return ':alias' + i;
          })
          .join(',')})`
      : '0';
    const conditions = [];
    if (query)
      conditions.push(
        `(search_han(e.hanji) LIKE :h ESCAPE '\\' OR EXISTS(SELECT 1 FROM reading r WHERE r.entry_id=e.id AND r.tailo_norm LIKE :r ESCAPE '\\') OR EXISTS(SELECT 1 FROM variant_char v WHERE v.entry_id=e.id AND search_han(v.variant) LIKE :h ESCAPE '\\') OR ${aliasCondition})`,
      );
    if (category) {
      params.category = positiveID(category);
      conditions.push(
        'EXISTS(SELECT 1 FROM entry_category ec JOIN category_minor cm ON cm.id=ec.minor_id WHERE ec.entry_id=e.id AND cm.major_id=:category)',
      );
    }
    const db = prepareSearch(await loadDatabase('moe'));
    let where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    let total = rows(db, 'SELECT COUNT(*) AS count FROM entry e' + where, params)[0].count;
    const order = ` ORDER BY CASE WHEN e.hanji=:raw THEN 0 WHEN search_han(e.hanji)=:q THEN 1 WHEN EXISTS(SELECT 1 FROM reading r WHERE r.entry_id=e.id AND r.tailo=:romanExact) THEN 2 WHEN ${aliasCondition} THEN 3 ELSE 4 END,e.id LIMIT :limit OFFSET :offset`;
    let found = rows(db, BRIEF + where + order, params),
      via = '';
    if (
      aliasIDs.length &&
      found.some((e) => aliasIDs.includes(e.id)) &&
      !found.some((e) => e.hanji === query)
    )
      via = '華語別稱';
    if (query && !total && !category) {
      where =
        " WHERE EXISTS(SELECT 1 FROM sense s WHERE s.entry_id=e.id AND search_han(s.definition) LIKE :meaning ESCAPE '\\') OR EXISTS(SELECT 1 FROM example ex WHERE ex.entry_id=e.id AND search_han(ex.huagi) LIKE :meaning ESCAPE '\\') OR EXISTS(SELECT 1 FROM dialect_comparison d JOIN dialect_comparison_link l USING(huagi_entry_id) WHERE l.entry_id=e.id AND search_han(d.huagi_term) LIKE :meaning ESCAPE '\\')";
      params.meaning = pattern(normalized, 'contains');
      params.meaningStart = pattern(normalized, 'prefix');
      total = rows(db, 'SELECT COUNT(*) AS count FROM entry e' + where, params)[0].count;
      const meaningOrder =
        " ORDER BY CASE WHEN EXISTS(SELECT 1 FROM dialect_comparison d JOIN dialect_comparison_link l USING(huagi_entry_id) WHERE l.entry_id=e.id AND search_han(d.huagi_term)=:q) THEN 0 WHEN EXISTS(SELECT 1 FROM sense s WHERE s.entry_id=e.id AND search_han(s.definition) LIKE :meaningStart ESCAPE '\\') THEN 1 WHEN EXISTS(SELECT 1 FROM sense s WHERE s.entry_id=e.id AND search_han(s.definition) LIKE :meaning ESCAPE '\\') THEN 2 ELSE 3 END,e.id LIMIT :limit OFFSET :offset";
      found = rows(db, BRIEF + where + meaningOrder, params);
      if (total) via = '華語意思';
    }
    if (total || !query || category)
      return {
        entries: found.map((e) => brief(e)),
        total,
        offset,
        source: 'moe',
        via,
        normalized: normalizeRoman(normalized),
      };
    const other = prepareSearch(await loadDatabase('soannteng'));
    where =
      " WHERE search_han(hanji) LIKE :h ESCAPE '\\' OR tailo_norm LIKE :r ESCAPE '\\' OR search_han(hoabun) LIKE :h ESCAPE '\\'";
    total = rows(other, 'SELECT COUNT(*) AS count FROM entry' + where, params)[0].count;
    found = rows(
      other,
      'SELECT * FROM entry' + where + ' ORDER BY id LIMIT :limit OFFSET :offset',
      params,
    );
    return {
      entries: found.map((e) => brief(e, 'soannteng')),
      total,
      offset,
      source: 'soannteng',
      via: '',
      normalized: normalizeRoman(normalized),
    };
  }
  async function annotate(text) {
    if (typeof text !== 'string' || text.length > 5000) throw new Error('每次最多輸入 5,000 字。');
    if (!lexicon) {
      const db = await loadDatabase('moe'),
        words = new Map();
      const data = rows(
        db,
        "SELECT id,hanji,hanji_raw,tailo_raw,tailo_marker,audio_basename FROM entry ORDER BY CASE entry_type WHEN 'main' THEN 0 ELSE 1 END,CASE tailo_marker WHEN 'peh' THEN 0 WHEN 'bun' THEN 2 ELSE 1 END,id",
      );
      let longest = 0;
      for (const row of data) {
        if (!row.hanji) continue;
        if (!words.has(row.hanji)) words.set(row.hanji, []);
        words.get(row.hanji).push(brief(row));
        longest = Math.max(longest, Array.from(row.hanji).length);
      }
      lexicon = { words, longest };
    }
    const chars = Array.from(text),
      result = [];
    for (let i = 0; i < chars.length;) {
      let found = null;
      for (let length = Math.min(lexicon.longest, chars.length - i); length > 0; length--) {
        const part = chars.slice(i, i + length).join('');
        if (lexicon.words.has(part)) {
          found = { text: part, entries: lexicon.words.get(part), kind: 'word' };
          i += length;
          break;
        }
      }
      if (!found) {
        const ch = chars[i++];
        found = { text: ch, entries: [], kind: /[\s\p{P}\p{N}]/u.test(ch) ? 'punct' : 'unknown' };
      }
      result.push(found);
    }
    return result;
  }
  return {
    getEntry,
    search,
    annotate,
    async request(path, options) {
      const url = new URL(path, 'https://taigi.invalid'),
        q = url.searchParams;
      if (url.pathname === '/api/meta') {
        const db = await loadDatabase('moe');
        return {
          name: '台語小辭典',
          categories: rows(db, 'SELECT * FROM category_major ORDER BY display_order'),
          dictionaryCount: rows(db, 'SELECT COUNT(*) AS count FROM entry')[0].count,
          fallbackCount: 91332,
          courseCount: courseMap.length,
          localAudioCount: 0,
          soundExamples,
          exampleAudioKeys: [
            ...new Set([...Object.keys(exampleAudio), ...Object.keys(audioCatalog.files)]),
          ],
        };
      }
      if (url.pathname === '/api/search') return search(q);
      if (url.pathname === '/api/entry') return getEntry(q.get('id'), q.get('source') || 'moe');
      if (url.pathname === '/api/course')
        return Promise.all(
          courseMap.map(async (c) => ({
            ...(await getEntry(c.entryId)),
            sequence: c.sequence,
            lesson: Math.floor((c.sequence - 1) / 100) + 1,
          })),
        );
      if (url.pathname === '/api/entries') {
        const result = [];
        for (const key of (q.get('ids') || '').split(',').filter(Boolean).slice(0, 1000)) {
          if (!/^(moe|soannteng):[1-9]\d*$/.test(key)) continue;
          const [source, id] = key.split(':');
          try {
            result.push(await getEntry(id, source));
          } catch (e) {
            if (e.message !== '找不到這個詞目。') throw e;
          }
        }
        return result;
      }
      if (url.pathname === '/api/annotate') {
        let data;
        try {
          data = JSON.parse(options?.body || '{}');
        } catch {
          throw new Error('文字格式不正確。');
        }
        return annotate(data?.text);
      }
      throw new Error('找不到這個功能。');
    },
  };
}
