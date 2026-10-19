<img src="site/assets/lenteyyy-logo.png" alt="Lenteyyy" width="180">

台語小辭典。大字查詞、真人錄音、每日複習。Made By 冷踢踢。

[直接使用](https://lenteyyy.github.io/taigi-pocket/)

支援漢字、臺羅、白話字與數字調號，提供收藏、自建詞表、私人筆記、逐詞標音、六種練習方式及十三個臺羅單元。每日新詞和複習數量分開設定，預設 10／20；字級預設 24 px，音量預設 80%。七課共 693 個詞，其中 682 個有釋義可出題。沒有 OCR，沒有帳號，也沒有付費牆。

查詞在瀏覽器處理，收藏、筆記與進度留在目前瀏覽器。換裝置或網址前，先在「閱讀設定與備份」匯出 JSON，再於新網址匯入；紀錄不會自動同步。

詞目和課程錄音直接播放教育部原音，需要網路。部分例句尚未核對官方音檔編號，會開啟原始詞目頁聆聽；本機 Python 版可即時解析官方例句。標音顯示詞典本調與候選讀音，不是自動翻譯或完整變調。

本機使用 Python 3，無須安裝套件：

~~~sh
git clone https://github.com/lenteyyy/taigi-pocket.git
cd taigi-pocket
python3 server.py
~~~

開啟 http://127.0.0.1:8765/ 。只想預覽靜態版，可用 python3 -m http.server 8767 --directory site。

開發與檢查使用 Node.js 22 以上：

~~~sh
npm ci
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run build
~~~

GitHub Pages 由 Actions 發布 dist/；部署前會執行測試。純靜態版以 Web Worker 與 sql.js 查詢壓縮詞典，初次需下載約 6 MB 主詞典；約 2.1 MB 補充詞典按需載入。沒有把 Python 後端放上 Pages。

程式碼採 [MIT](LICENSE)。教育部詞典、錄音、台文華文線頂辭典、字型與 Logo 依各自條款使用，詳見 [來源與授權](NOTICE.md)。Logo 不包含在 MIT 授權內，衍生專案請替換自己的標誌。程式碼署名供辨識來源，不是防複製機制。
