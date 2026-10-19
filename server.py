#!/usr/bin/env python3
"""台語小辭典：僅使用 Python 標準函式庫的本機服務。"""
import argparse
import gzip
import contextlib
import functools
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import sqlite3
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
DATA = ROOT / '.cache' / 'data'
STATIC = ROOT / 'site'
ORIGIN = 'https://sutian.moe.edu.tw'
LOCK = threading.Lock()
# Made By 冷踢踢


def bootstrap():
    DATA.mkdir(parents=True, exist_ok=True)
    for name in ('taigi-dict.sqlite', 'taigi-soannteng.sqlite'):
        target = DATA / name
        if not target.exists():
            target.write_bytes(gzip.decompress((STATIC / 'data' / (name + '.gz')).read_bytes()))
    if not (DATA / 'courses.json').exists():
        shutil.copy2(STATIC / 'data' / 'courses.json', DATA / 'courses.json')


@contextlib.contextmanager
def db(fallback=False):
    path = DATA / ('taigi-soannteng.sqlite' if fallback else 'taigi-dict.sqlite')
    c = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    try:
        yield c
    finally:
        c.close()


def normalize(s):
    s = unicodedata.normalize('NFD', s.lower().replace('ⁿ', 'nn'))
    s = re.sub(r'o([\u0300-\u036f]*)\u0358', r'o\1o', s)
    s = ''.join(x for x in s if not unicodedata.combining(x))
    s = s.replace('chh', 'tsh').replace('ch', 'ts').replace('eng', 'ing').replace('ek', 'ik')
    return re.sub('[1-9]', '', s).strip()


def pattern(q, mode):
    value = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    if mode == 'wildcard':
        return value.replace('*', '%').replace('?', '_')
    return {'prefix': value + '%', 'suffix': '%' + value, 'contains': '%' + value + '%', 'exact': value}.get(mode, value + '%')


def number_to_tone(text):
    marks = {'2': '\u0301', '3': '\u0300', '5': '\u0302', '7': '\u0304', '8': '\u030d', '9': '\u030b'}
    def convert(match):
        base, tone = match.groups()
        if tone not in marks:
            return base
        lower = base.lower()
        index = lower.find('a')
        if index < 0:
            index = lower.find('oo')
        if index < 0:
            indexes = [i for i, ch in enumerate(lower) if ch in 'eo']
            index = indexes[0] if indexes else -1
        if index < 0:
            index = max(lower.rfind('i'), lower.rfind('u'))
        if index < 0:
            index = lower.find('n') if 'n' in lower else lower.find('m')
        return unicodedata.normalize('NFC', base[:index+1] + marks[tone] + base[index+1:]) if index >= 0 else base
    return re.sub(r'([a-z]+)([1-9])', convert, text, flags=re.I)


def brief(row, source='moe'):
    r = dict(row)
    if source == 'soannteng':
        return {'id': r['id'], 'source': source, 'hanji': r['hanji'], 'tailo': r['tailo'] or r['poj'] or '', 'definition': r['hoabun'] or '', 'marker': None, 'audio': False}
    roman = re.sub(r'【[^】]+】', '', r['tailo_raw'] or '')
    return {'id': r['id'], 'source': source, 'hanji': r['hanji_raw'], 'tailo': roman, 'definition': r.get('definition', '') or '', 'marker': r['tailo_marker'], 'audio': bool(r['audio_basename'])}


BRIEF_SQL = "SELECT e.*, (SELECT definition FROM sense s WHERE s.entry_id=e.id ORDER BY sense_order LIMIT 1) AS definition FROM entry e "


def search(query, mode='prefix', category='', offset=0, limit=70):
    if mode not in ('prefix', 'suffix', 'contains', 'wildcard', 'exact'):
        raise ValueError('搜尋模式不正確。')
    q = query.strip()[:150]
    params = {'h': pattern(q, mode), 'r': pattern(normalize(q), mode), 'q': q, 'romanExact': number_to_tone(q), 'limit': min(limit, 150), 'offset': max(0, offset)}
    where = []
    if q:
        where.append("(e.hanji LIKE :h ESCAPE '\\' OR EXISTS(SELECT 1 FROM reading r WHERE r.entry_id=e.id AND r.tailo_norm LIKE :r ESCAPE '\\') OR EXISTS(SELECT 1 FROM variant_char v WHERE v.entry_id=e.id AND v.variant LIKE :h ESCAPE '\\'))")
    if category:
        params['category'] = int(category)
        where.append('EXISTS(SELECT 1 FROM entry_category ec JOIN category_minor cm ON cm.id=ec.minor_id WHERE ec.entry_id=e.id AND cm.major_id=:category)')
    condition = ' WHERE ' + ' AND '.join(where) if where else ''
    with db() as c:
        total = c.execute('SELECT COUNT(*) FROM entry e' + condition, params).fetchone()[0]
        rows = c.execute(BRIEF_SQL + condition + ' ORDER BY CASE WHEN e.hanji=:q THEN 0 WHEN EXISTS(SELECT 1 FROM reading r WHERE r.entry_id=e.id AND r.tailo=:romanExact) THEN 1 ELSE 2 END,e.id LIMIT :limit OFFSET :offset', params).fetchall()
        via = ''
        if q and not total and not category:
            # 華語查詢只在詞目找不到時才比對釋義，保留原文。
            condition = " WHERE EXISTS(SELECT 1 FROM sense s WHERE s.entry_id=e.id AND s.definition LIKE :h ESCAPE '\\')"
            params['h'] = '%' + q.replace('%', '\\%').replace('_', '\\_') + '%'
            total = c.execute('SELECT COUNT(*) FROM entry e' + condition, params).fetchone()[0]
            rows = c.execute(BRIEF_SQL + condition + ' ORDER BY e.id LIMIT :limit OFFSET :offset', params).fetchall()
            if total:
                via = '華語釋義'
    if total or not q or category:
        return {'entries': [brief(r) for r in rows], 'total': total, 'offset': offset, 'source': 'moe', 'via': via, 'normalized': normalize(q)}
    with db(True) as c:
        condition = " WHERE hanji LIKE :h ESCAPE '\\' OR tailo_norm LIKE :r ESCAPE '\\' OR hoabun LIKE :h ESCAPE '\\'"
        params['h'] = pattern(q, mode)
        total = c.execute('SELECT COUNT(*) FROM entry' + condition, params).fetchone()[0]
        rows = c.execute('SELECT * FROM entry' + condition + ' ORDER BY id LIMIT :limit OFFSET :offset', params).fetchall()
    return {'entries': [brief(r, 'soannteng') for r in rows], 'total': total, 'offset': offset, 'source': 'soannteng', 'via': '', 'normalized': normalize(q)}


@functools.lru_cache(maxsize=2000)
def entry(eid, source='moe'):
    with db(source == 'soannteng') as c:
        row = c.execute('SELECT * FROM entry WHERE id=?', (eid,)).fetchone()
        if not row:
            raise ValueError('找不到這個詞目。')
        result = brief(row, source)
        if source == 'soannteng':
            result.update({'poj': row['poj'], 'senses': [{'definition': row['hoabun'] or '', 'pos': '', 'examples': []}], 'readings': [], 'variants': [], 'alternates': [], 'relations': [], 'dialects': [], 'categories': []})
            return result
        result['readings'] = [r[0] for r in c.execute('SELECT tailo FROM reading WHERE entry_id=? ORDER BY reading_order', (eid,))]
        result['senses'] = []
        for s in c.execute('SELECT * FROM sense WHERE entry_id=? ORDER BY sense_order', (eid,)):
            ex = [dict(x) for x in c.execute('SELECT id,hanji,tailo,huagi,audio_basename FROM example WHERE sense_id=? ORDER BY example_order', (s['id'],))]
            result['senses'].append({'id': s['id'], 'pos': s['pos'], 'definition': s['definition'], 'examples': ex})
        result['definition'] = result['senses'][0]['definition'] if result['senses'] else ''
        result['variants'] = [r[0] for r in c.execute('SELECT variant FROM variant_char WHERE entry_id=?', (eid,))]
        result['alternates'] = [dict(r) for r in c.execute('SELECT alt_type,hanji,tailo_raw FROM alt_pronunciation WHERE entry_id=?', (eid,))]
        relations = []
        for r in c.execute("SELECT sr.* FROM semantic_relation sr WHERE (sr.source_kind='entry' AND sr.source_id=?) OR (sr.source_kind='sense' AND sr.source_id IN(SELECT id FROM sense WHERE entry_id=?))", (eid, eid)):
            target = r['target_id']
            if r['target_kind'] == 'sense':
                s = c.execute('SELECT entry_id FROM sense WHERE id=?', (target,)).fetchone()
                target = s[0] if s else 0
            t = c.execute('SELECT id,hanji_raw,tailo_raw FROM entry WHERE id=?', (target,)).fetchone()
            if t:
                relations.append({'type': r['relation_type'], 'id': t[0], 'hanji': t[1], 'tailo': t[2]})
        for t in c.execute('SELECT e.id,e.hanji_raw,e.tailo_raw FROM cross_reference cr JOIN entry e ON e.id=cr.related_entry_id WHERE cr.entry_id=?', (eid,)):
            relations.append({'type': 'related', 'id': t[0], 'hanji': t[1], 'tailo': t[2]})
        result['relations'] = list({(r['type'], r['id']): r for r in relations}.values())
        result['categories'] = [dict(r) for r in c.execute('SELECT cm.id,cm.name FROM entry_category ec JOIN category_minor cm ON cm.id=ec.minor_id WHERE ec.entry_id=?', (eid,))]
        result['dialects'] = [dict(r) for r in c.execute('SELECT accent,hanji,tailo_raw,huagi_term FROM dialect_comparison WHERE huagi_entry_id IN(SELECT huagi_entry_id FROM dialect_comparison_link WHERE entry_id=?)', (eid,))]
        result['accentVariants'] = [dict(r) for r in c.execute('SELECT hanji,accent_region,tailo_raw FROM accent_variant WHERE entry_id=?', (eid,))]
        return result


@functools.lru_cache(maxsize=1)
def course():
    cards = json.loads((DATA / 'courses.json').read_text())
    result = []
    for card in cards:
        e = dict(entry(card['entryId']))
        e.update({'sequence': card['sequence'], 'lesson': (card['sequence'] - 1) // 100 + 1})
        result.append(e)
    return result


@functools.lru_cache(maxsize=1)
def lexicon():
    with db() as c:
        words = {}
        for r in c.execute('SELECT id,hanji,hanji_raw,tailo_raw,tailo_marker,audio_basename FROM entry ORDER BY CASE entry_type WHEN \'main\' THEN 0 ELSE 1 END,CASE tailo_marker WHEN \'peh\' THEN 0 WHEN \'bun\' THEN 2 ELSE 1 END,id'):
            if r['hanji']:
                words.setdefault(r['hanji'], []).append({'id': r['id'], 'hanji': r['hanji_raw'], 'tailo': re.sub(r'【[^】]+】', '', r['tailo_raw'] or ''), 'marker': r['tailo_marker'], 'audio': bool(r['audio_basename']), 'source': 'moe'})
    return words, max(map(len, words))


def annotate(text):
    words, longest = lexicon()
    result, i = [], 0
    while i < len(text):
        found = None
        for size in range(min(longest, len(text) - i), 0, -1):
            part = text[i:i + size]
            if part in words:
                found = {'text': part, 'entries': words[part], 'kind': 'word'}
                i += size
                break
        if not found:
            ch = text[i]
            found = {'text': ch, 'entries': [], 'kind': 'punct' if ch.isspace() or unicodedata.category(ch).startswith(('P', 'N')) else 'unknown'}
            i += 1
        result.append(found)
    return result


class Node(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {'tag': '', 'attrs': {}, 'children': []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'attrs': dict(attrs), 'children': []}
        self.stack[-1]['children'].append(node)
        if tag not in ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'):
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]['tag'] == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, text):
        self.stack[-1]['children'].append(text)


def descendants(node, tag=None):
    for ch in node['children']:
        if isinstance(ch, dict):
            if not tag or ch['tag'] == tag:
                yield ch
            yield from descendants(ch, tag)


def textof(node):
    return ''.join(textof(ch) if isinstance(ch, dict) else ch for ch in node['children']).strip()


def parse_audio_page(page):
    parser = Node()
    parser.feed(page)
    word = None
    for header in descendants(parser.root, 'header'):
        for button in descendants(header, 'button'):
            src = button['attrs'].get('data-src', '')
            if '/subak/' in src:
                word = src
                break
    examples = []
    for li in descendants(parser.root, 'li'):
        audio = next((n['attrs'].get('data-src') for n in descendants(li, 'button') if '/leku/' in n['attrs'].get('data-src', '')), None)
        if audio:
            spans = [n for n in descendants(li, 'span') if 'mb-0' in n['attrs'].get('class', '').split()]
            if spans:
                examples.append({'hanji': textof(spans[0]), 'url': audio})
    return {'word': word, 'examples': examples}


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'TaigiLocalDictionary/1.0 (personal learning)', 'Accept': '*/*'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read()


def audio_file(eid, example_id=0):
    cache = DATA / 'audio-cache'
    cache.mkdir(exist_ok=True)
    dest = cache / f'{eid}-{example_id}.mp3'
    if dest.exists():
        return dest
    with LOCK:
        if dest.exists():
            return dest
        mapping = cache / f'{eid}.json'
        if mapping.exists():
            info = json.loads(mapping.read_text())
        else:
            info = parse_audio_page(fetch(f'{ORIGIN}/zh-hant/su/{eid}/').decode('utf-8'))
            mapping.write_text(json.dumps(info, ensure_ascii=False))
        src = info.get('word')
        if example_id:
            with db() as c:
                ex = c.execute('SELECT hanji FROM example WHERE id=? AND entry_id=?', (example_id, eid)).fetchone()
            if not ex:
                raise ValueError('找不到例句音檔。')
            clean = lambda s: re.sub(r'[\s。．.!！?？,，；;：:「」『』]', '', s)
            src = next((x['url'] for x in info['examples'] if clean(x['hanji']) == clean(ex[0])), None)
        if not src:
            raise ValueError('官方頁面目前未提供這筆錄音。')
        url = urllib.parse.urljoin(ORIGIN, src)
        if urllib.parse.urlparse(url).hostname != 'sutian.moe.edu.tw':
            raise ValueError('音檔來源不正確。')
        payload = fetch(url)
        if not (payload.startswith(b'ID3') or payload[:1] == b'\xff'):
            raise ValueError('音檔格式無法辨識。')
        temp = dest.with_suffix('.tmp')
        temp.write_bytes(payload)
        temp.replace(dest)
    return dest


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        if not args or str(args[0]).startswith('GET /api/audio') or (len(args) > 1 and str(args[1]) != '200'):
            super().log_message(fmt, *args)

    def send_json(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path in ('/', '/index.html'):
            payload=(STATIC / 'index.html').read_bytes().replace(b'data-runtime="static"', b'data-runtime="server"')
            self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(payload)))
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(payload)
            return
        if not url.path.startswith('/api/'):

            return super().do_GET()
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if url.path == '/api/meta':
                with db() as c:
                    categories = [dict(r) for r in c.execute('SELECT * FROM category_major ORDER BY display_order')]
                return self.send_json({'name': '台語小辭典', 'categories': categories, 'dictionaryCount': 29591, 'fallbackCount': 91332, 'courseCount': 693, 'localAudioCount': 0, 'soundExamples': json.loads((STATIC / 'data' / 'sound-examples.json').read_text())})
            if url.path == '/api/search':
                return self.send_json(search(q.get('q', ''), q.get('mode', 'prefix'), q.get('category', ''), int(q.get('offset', 0))))
            if url.path == '/api/entry':
                if q.get('source', 'moe') not in ('moe', 'soannteng'):
                    raise ValueError('資料來源不正確。')
                return self.send_json(entry(int(q['id']), q.get('source', 'moe')))
            if url.path == '/api/course':
                return self.send_json(course())
            if url.path == '/api/entries':
                ids = [x for x in q.get('ids', '').split(',') if x][:1000]
                result = []
                for ident in ids:
                    source, eid = ident.split(':') if ':' in ident else ('moe', ident)
                    if source not in ('moe', 'soannteng'):
                        continue
                    try:
                        result.append(entry(int(eid), source))
                    except ValueError:
                        pass
                return self.send_json(result)
            if url.path == '/api/audio':
                p = audio_file(int(q['entry']), int(q.get('example', 0)))
                payload = p.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Cache-Control', 'private, max-age=31536000')
                self.end_headers()
                self.wfile.write(payload)
                return
            return self.send_json({'error': '找不到這個功能。'}, 404)
        except (ValueError, KeyError) as e:
            return self.send_json({'error': str(e)}, 400)
        except Exception as e:
            print('服務錯誤：', url.path, repr(e), flush=True)
            return self.send_json({'error': '目前無法連線至官方音檔，請確認網路後重試。' if 'audio' in url.path else '資料暫時無法讀取，請重新整理。'}, 502)

    def do_POST(self):
        if self.path != '/api/annotate':
            return self.send_json({'error': '找不到這個功能。'}, 404)
        # 僅接受本機同源請求；本文不寫入伺服器或傳送第三方。
        origin = self.headers.get('Origin', '')
        if origin and urllib.parse.urlparse(origin).netloc != self.headers.get('Host'):
            return self.send_json({'error': '不接受跨網站請求。'}, 403)
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 100000:
                raise ValueError('文字太長，請分段輸入。')
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError('請提供包含文字的 JSON 物件。')
            text = payload.get('text', '')
            if not isinstance(text, str) or len(text) > 5000:
                raise ValueError('每次最多輸入 5,000 字。')
            return self.send_json(annotate(text))
        except (ValueError, TypeError, UnicodeError):
            return self.send_json({'error': '文字格式不正確，每次最多輸入 5,000 字。'}, 400)


def main():
    parser = argparse.ArgumentParser(description='台語小辭典本機服務')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    bootstrap()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'台語小辭典已啟動：http://127.0.0.1:{args.port}', flush=True)
    print('查詞與學習資料均保留在本機；首次播放官方錄音需要網路。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
