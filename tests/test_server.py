import importlib.util
from pathlib import Path
import unittest
import json
import hashlib
import threading
import urllib.request
import urllib.error

spec=importlib.util.spec_from_file_location('taigi_server',Path(__file__).resolve().parents[1]/'server.py')
server=importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class DictionaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.bootstrap()

    def test_counts_and_course_identity(self):
        cards=server.course()
        self.assertEqual(len(cards),693)
        self.assertEqual({x['lesson'] for x in cards},set(range(1,8)))
        self.assertEqual(len({x['sequence'] for x in cards}),693)

    def test_search_and_literal_wildcards(self):
        self.assertEqual(server.normalize('ó\u0358'),'oo')
        self.assertEqual(server.search('食','exact')['entries'][0]['hanji'],'食')
        self.assertTrue(any(x['id']==5570 for x in server.search('tsiah8','exact')['entries']))
        self.assertTrue(any(x['id']==5570 for x in server.search('chiah8','exact')['entries']))
        self.assertEqual(server.search('ho2','exact')['entries'][0]['tailo'],'hó')
        self.assertTrue(server.search('日*子','wildcard')['entries'])
        for mode in ('prefix','contains','suffix'):
            matches=server.search('食',mode)['entries']
            self.assertTrue(matches)
            for match in matches:
                hanji=match['hanji'].replace('【替】','')
                self.assertTrue(hanji.startswith('食') if mode=='prefix' else hanji.endswith('食') if mode=='suffix' else '食' in hanji)
        literal=server.search('%','exact')
        self.assertLess(literal['total'],5)
        self.assertTrue(all('%' in e['definition'] for e in literal['entries']))

    def test_entry_relations_examples_and_annotation(self):
        word=server.entry(5570)
        self.assertTrue(word['senses'])
        self.assertEqual(word['readings'][0],'tsia̍h')
        self.assertTrue(any(x['hanji']=='食果子' for s in word['senses'] for x in s['examples']))
        text='今仔日天氣真好。🛸'
        tokens=server.annotate(text)
        self.assertEqual(''.join(x['text'] for x in tokens),text)
        self.assertEqual(tokens[0]['text'],'今仔日')
        self.assertEqual(tokens[-1]['kind'],'unknown')
        self.assertEqual(server.annotate('未')[0]['entries'][0]['marker'],'peh')

    def test_audio_parser_matches_words_and_examples(self):
        page='<header><button data-src="/media/senn/mp3/imtong/subak/0/1.mp3"></button></header><li class="mb-3"><span class="mb-0">一蕊花</span><button data-src="/media/senn/mp3/imtong/leku/45/45549.mp3"></button></li>'
        parsed=server.parse_audio_page(page)
        self.assertTrue(parsed['word'].endswith('/1.mp3'))
        self.assertEqual(parsed['examples'][0]['hanji'],'一蕊花')

    def test_all_lessons_and_local_assets(self):
        self.assertEqual([sum(e['lesson']==n for e in server.course()) for n in range(1,8)], [97,100,98,100,100,99,99])
        self.assertEqual(len(json.loads((server.STATIC/'data/sound-examples.json').read_text())),54)
        self.assertEqual(hashlib.sha256((server.STATIC/'assets/lenteyyy-logo.png').read_bytes()).hexdigest(),'e98eb6116fc3d0e2b38207abaf242ad623f9779f6744b78496f57f0ccaf958d8')


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()

    def call(self,path,body=None,headers=None):
        request=urllib.request.Request(self.base+path,data=body,headers=headers or {})
        try:
            response=urllib.request.urlopen(request,timeout=15)
        except urllib.error.HTTPError as error:
            response=error
        with response:
            return response.status,response.headers,response.read()

    def test_api_and_static_responses(self):
        for path in ('/api/meta','/api/course','/api/search?q=ho2','/api/entry?id=5570','/api/entries?ids=moe:5570,moe:2415','/assets/lenteyyy-logo.png','/app.mjs','/core.mjs','/style.css','/data/sound-examples.json'):
            status,headers,payload=self.call(path)
            self.assertEqual(status,200,path)
            self.assertTrue(payload,path)
            if path.startswith('/api/'):
                json.loads(payload)
                self.assertEqual(headers['Cache-Control'],'no-store')

    def test_annotation_and_invalid_payloads(self):
        status,_,payload=self.call('/api/annotate',json.dumps({'text':'食飽未？'}).encode())
        self.assertEqual(status,200)
        self.assertEqual(''.join(x['text'] for x in json.loads(payload)),'食飽未？')
        for body in (b'[]',b'null',b'123',b'{invalid',b'\xff',b'{"text":123}',json.dumps({'text':'字'*5001}).encode()):
            status,_,payload=self.call('/api/annotate',body)
            self.assertEqual(status,400,body[:30])
            self.assertIn('error',json.loads(payload))
        self.assertEqual(self.call('/api/annotate',b'{}',{'Origin':'https://example.com'})[0],403)

    def test_invalid_api_arguments(self):
        for path in ('/api/entry?id=abc','/api/entry?id=1&source=bad','/api/search?mode=bad','/api/search?offset=bad'):
            self.assertEqual(self.call(path)[0],400,path)
        self.assertEqual(self.call('/api/missing')[0],404)


if __name__=='__main__':
    unittest.main()
