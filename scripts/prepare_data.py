"""從公開授權的詞典 SQLite 快照產生瀏覽器資料；不匯出使用者紀錄。"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import unicodedata

ROOT = Path(__file__).resolve().parents[1]

def normalize(text):
    text = unicodedata.normalize('NFD', text.lower().replace('ⁿ', 'nn'))
    text = re.sub(r'o([\u0300-\u036f]*)\u0358', r'o\1o', text)
    return re.sub('[1-9]', '', ''.join(c for c in text if not unicodedata.combining(c)))

def prepare(source):
    target = ROOT/'site/data'
    target.mkdir(parents=True, exist_ok=True)
    provenance = {}
    for name in ('taigi-dict.sqlite', 'taigi-soannteng.sqlite'):
        origin = source/name
        src = sqlite3.connect(origin.as_uri()+'?mode=ro', uri=True)
        with tempfile.TemporaryDirectory() as tmp:
            dest = sqlite3.connect(str(Path(tmp)/'dictionary.sqlite'))
            # 重建一般資料表，不分發原 App 的搜尋索引或程式碼。
            for table, in src.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'"):
                columns = list(src.execute(f'PRAGMA table_info("{table}")'))
                names = ','.join('"'+c[1]+'"' for c in columns)
                defs = ','.join('"'+c[1]+'" '+c[2]+(' PRIMARY KEY' if c[5] and c[1]=='id' else '') for c in columns)
                dest.execute(f'CREATE TABLE "{table}" ({defs})')
                rows = src.execute(f'SELECT {names} FROM "{table}"')
                dest.executemany(f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in columns)})', rows)
                for column in columns:
                    if column[1].endswith('_id') and column[1] != 'id':
                        dest.execute(f'CREATE INDEX "idx_{table}_{column[1]}" ON "{table}"("{column[1]}")')
            dest.commit()
            dest.execute('VACUUM')
            dest.close()
            payload = (Path(tmp)/'dictionary.sqlite').read_bytes()
            (target/(name+'.gz')).write_bytes(gzip.compress(payload, mtime=0))
            provenance[name] = {'sourceSHA256':hashlib.sha256(origin.read_bytes()).hexdigest(), 'publishedSHA256':hashlib.sha256(payload).hexdigest(), 'metadata':dict(src.execute('SELECT * FROM meta')), 'entryCount':src.execute('SELECT COUNT(*) FROM entry').fetchone()[0]}
        src.close()
    cards = json.loads((source/'courses.json').read_text())
    (target/'courses.json').write_text(json.dumps([{'sequence':x['sequence'],'entryId':x['entryId']} for x in cards], ensure_ascii=False, separators=(',',':')))
    db = sqlite3.connect(source/'taigi-dict.sqlite')
    db.row_factory = sqlite3.Row
    words = [dict(row) for row in db.execute("SELECT e.id,e.hanji,e.tailo_raw,e.tailo_marker,r.tailo_norm FROM entry e JOIN reading r ON r.entry_id=e.id WHERE e.audio_basename IS NOT NULL AND e.audio_basename<>'' AND length(e.hanji)<=2 ORDER BY CASE WHEN e.tailo_marker='peh' THEN 0 WHEN e.tailo_marker='bun' THEN 2 ELSE 1 END,e.id")]
    sounds = ('p ph b m t th n l k kh g ng ts tsh j s h a oo o e i u ai au ia io iu ua ue ui iau uai am an ang ap at ak ah ann inn enn onn iann iunn uann uainn iaunn ho lai khi sik jit').split()
    initials = sorted('p ph b m t th n l k kh g ng ts tsh j s h'.split(), key=len, reverse=True)
    examples = {}
    for sound in sounds:
        candidates = []
        for word in words:
            roman = word['tailo_norm'] or ''
            if any(c in roman for c in ' /-'): continue
            initial = next((i for i in initials if roman.startswith(i)), '')
            matches = initial == sound and len(roman)>len(initial) if sound in initials else roman == sound or roman[len(initial):] == sound
            if matches: candidates.append(word)
        if not candidates: raise ValueError('找不到適合的教育部例字：'+sound)
        choice = next((w for w in candidates if w['tailo_norm']==sound), candidates[0])
        examples[sound] = {'entry':choice['id'], 'hanji':choice['hanji'], 'tailo':re.sub('【[^】]+】','',choice['tailo_raw'])}
    (target/'sound-examples.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2)+'\n')
    # 例句僅使用從官方頁面實際確認的網址，不能以本地例句編號猜網址。
    audio = {}
    clean = lambda s: re.sub(r'[\s。．.!！?？,，；;：:「」『』]','',s)
    for mapping in sorted((source/'audio-cache').glob('*.json')):
        if not mapping.stem.isdigit(): continue
        info = json.loads(mapping.read_text())
        for row in db.execute('SELECT id,hanji FROM example WHERE entry_id=?',(int(mapping.stem),)):
            found = next((x['url'] for x in info.get('examples',[]) if clean(x['hanji'])==clean(row['hanji'])),None)
            if found and re.fullmatch(r'/media/senn/mp3/imtong/leku/\d+/\d+\.mp3',found):
                audio[str(row['id'])] = found
    (target/'example-audio.json').write_text(json.dumps(audio,ensure_ascii=False,indent=2)+'\n')
    (target/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
    db.close()
    print('已產生兩部詞典、七課映射及',len(examples),'個官方錄音例字。')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    prepare(parser.parse_args().source.resolve())
