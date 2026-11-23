"""核對詞庫原始檔名與固定版本的鏡像 Git 索引，不下載或改寫錄音。"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def prepare(mirror_path, version):
    if not re.fullmatch(r'\d{8}-\d{4}', version):
        raise ValueError('鏡像版本不正確。')
    mirror = json.loads(mirror_path.read_text())
    if mirror.get('truncated') or not re.fullmatch(r'[a-f0-9]{40}', mirror['sha']):
        raise ValueError('鏡像索引不完整。')
    names = {x['path'] for x in mirror['tree'] if x['type'] == 'blob'}
    raw = gzip.decompress((ROOT/'site/data/taigi-dict.sqlite.gz').read_bytes())
    with tempfile.NamedTemporaryFile() as temp:
        temp.write(raw)
        temp.flush()
        with sqlite3.connect(temp.name) as db:
            rows = db.execute("SELECT id,audio_basename FROM entry WHERE audio_basename<>'' ORDER BY id").fetchall()
    files = {}
    for ident, basename in rows:
        name = basename + '.mp3'
        if not re.fullmatch(str(ident) + r'\(\d+\)\.mp3', name) or name not in names:
            raise ValueError('未核對的詞目音檔：' + name)
        files[str(ident)] = name
    catalog = {
        'version': version,
        'baseURL': f'https://chhoetaigi.github.io/KipSutianDataMirror/public/{version}/imtong/sutiau/',
        'mirrorTreeSHA': mirror['sha'],
        'sourceDatabaseSHA256': hashlib.sha256(raw).hexdigest(),
        'officialArchive': 'https://sutian.moe.edu.tw/media/senn/sutiau-mp3.zip',
        'license': 'CC BY-ND 3.0 TW',
        'files': files,
    }
    (ROOT/'site/data/word-audio-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':'))+'\n')
    print('已核對', len(files), '筆詞目錄音檔名。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mirror-index', type=Path, required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    prepare(args.mirror_index, args.version)
