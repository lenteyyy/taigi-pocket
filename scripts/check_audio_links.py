"""按需核對 54 個公開課程例字音檔；不播放、不保存錄音。"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.request

root=Path(__file__).resolve().parents[1]
sounds=json.loads((root/'site/data/sound-examples.json').read_text())
def check(item):
    sound,word=item
    eid=word['entry']
    url=f'https://sutian.moe.edu.tw/media/senn/mp3/imtong/subak/{eid//1000}/{eid}.mp3'
    try:
        request=urllib.request.Request(url,headers={'User-Agent':'TaigiPocket/1.0 audio-check','Range':'bytes=0-15'})
        with urllib.request.urlopen(request,timeout=20) as response:
            data=response.read(16)
            ok=response.status in (200,206) and (data.startswith(b'ID3') or data[:1]==b'\xff')
            return {'sound':sound,'entry':eid,'ok':ok,'status':response.status}
    except Exception as error:
        return {'sound':sound,'entry':eid,'ok':False,'error':str(error)}
with ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(check,sounds.items()))
target=root/'artifacts/audio-links.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checked':len(results),'passed':sum(x['ok'] for x in results),'failed':[x for x in results if not x['ok']]},ensure_ascii=False))
raise SystemExit(0 if all(x['ok'] for x in results) else 1)
