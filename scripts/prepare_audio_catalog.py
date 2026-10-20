"""以官方 ZIP 與鏡像的檔名索引核對例句；不猜新版網站的例句編號。"""
import argparse
import gzip
import json
from pathlib import Path
import re
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def prepare(official_path, mirror_path):
    official = json.loads(official_path.read_text())
    mirror = json.loads(mirror_path.read_text())
    assert re.fullmatch(r'\d{8}-\d{4}', mirror['version'])
    official_files = {Path(name).name for name in official['files']}
    mirror_files = set(mirror['files'])
    with tempfile.NamedTemporaryFile(suffix='.sqlite') as temp:
        temp.write(gzip.decompress((ROOT/'site/data/taigi-dict.sqlite.gz').read_bytes()))
        temp.flush()
        with sqlite3.connect(temp.name) as db:
            entries = db.execute("SELECT id,audio_basename FROM example WHERE audio_basename<>''").fetchall()
    files = {}
    for ident, basename in entries:
        filename = basename + '.mp3'
        if not re.fullmatch(r'\d+-\d+-\d+\.mp3', filename):
            raise ValueError('例句檔名不正確：'+filename)
        if filename not in official_files or filename not in mirror_files:
            raise ValueError('例句未在官方與鏡像雙方找到：'+filename)
        files[str(ident)] = filename
    catalog = {
        'version': mirror['version'],
        'baseURL': 'https://chhoetaigi.github.io/KipSutianDataMirror/public/'+mirror['version']+'/imtong/leku/',
        'officialArchive': official['url'],
        'officialDirectorySHA256': official['directorySHA256'],
        'mirrorTreeSHA': mirror['treeSHA'],
        'license': 'CC BY-ND 3.0 TW',
        'files': files,
    }
    (ROOT/'site/data/audio-catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')
    print('已核對並建立',len(files),'筆例句錄音索引。')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--official-index',type=Path,required=True)
    parser.add_argument('--mirror-index',type=Path,required=True)
    args = parser.parse_args()
    prepare(args.official_index,args.mirror_index)
