#!/usr/bin/env python3
"""建立獨立搜尋對照，不改動原始詞典。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'site/vendor/opencc/TSCharacters.txt'
SHA256 = '6b5a0a799bea2bb22c001f635eaa3fc2904310f0c08addbff275477a80ecf09a'


def build():
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise ValueError('OpenCC 字表雜湊不符。')
    characters = {}
    for line in raw.decode('utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        source, candidates = line.split('\t')
        target = candidates.split()[0]
        if len(source) != 1 or len(target) != 1:
            raise ValueError('字形搜尋對照必須為單字元。')
        characters[source] = target
    aliases = [
        (894, ['壞小子', '壞孩子', '壞胚子', '不良少年', '浪蕩子']),
        (2142, ['小孩', '小孩子', '小朋友', '孩子']),
        (1093, ['不好意思', '對不起', '抱歉']),
        (8623, ['沒關係', '沒有關係', '不要緊']),
        (2415, ['謝謝', '感謝']),
        (4524, ['媽媽', '母親']),
        (4558, ['爸爸', '父親']),
        (2894, ['哪裡', '哪兒', '在哪裡']),
        (7101, ['什麼']),
        (629, ['今天', '今日']),
        (4208, ['明天', '明日']),
        (5016, ['昨天', '昨日']),
        (1975, ['眼睛']),
        (1665, ['屁股']),
        (10126, ['自行車', '腳踏車', '單車']),
        (5090, ['番茄', '西紅柿']),
    ]
    result = {
        'version': 1,
        'opencc': {
            'version': 'ver.1.1.9',
            'source': 'https://github.com/BYVoid/OpenCC/blob/ver.1.1.9/data/dictionary/TSCharacters.txt',
            'sha256': SHA256,
            'license': 'Apache-2.0',
            'usage': '共用繁簡搜尋鍵；顯示文字保留原始詞典內容。',
        },
        'characters': characters,
        'aliases': [{'entryId': entry, 'terms': terms} for entry, terms in aliases],
    }
    path = ROOT / 'site/data/search.json'
    path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'搜尋對照：{len(characters)} 個字形，{len(aliases)} 組華語別稱。')


if __name__ == '__main__':
    build()
