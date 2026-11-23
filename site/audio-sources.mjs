export function wordSources(id, catalog) {
  const number = Number(id);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('詞目編號不正確。');
  const official = `https://sutian.moe.edu.tw/media/senn/mp3/imtong/subak/${Math.floor(number / 1000)}/${number}.mp3`;
  const file = catalog?.files?.[String(number)];
  const mirror =
    new RegExp(`^${number}\\(\\d+\\)\\.mp3$`).test(file || '') &&
    /^https:\/\/chhoetaigi\.github\.io\/KipSutianDataMirror\/public\/\d{8}-\d{4}\/imtong\/sutiau\/$/.test(
      catalog.baseURL || '',
    );
  return mirror ? [new URL(file, catalog.baseURL).href, official] : [official];
}

export function exampleSources(id, official, catalog) {
  const sources = [];
  const path = official[String(id)];
  if (/^\/media\/senn\/mp3\/imtong\/leku\/\d+\/\d+\.mp3$/.test(path || ''))
    sources.push('https://sutian.moe.edu.tw' + path);
  const file = catalog?.files?.[String(id)];
  if (
    /^\d+-\d+-\d+\.mp3$/.test(file || '') &&
    /^https:\/\/chhoetaigi\.github\.io\/KipSutianDataMirror\/public\/\d{8}-\d{4}\/imtong\/leku\/$/.test(
      catalog.baseURL || '',
    )
  )
    sources.push(new URL(file, catalog.baseURL).href);
  if (!sources.length) throw new Error('這筆例句目前沒有可用的錄音。');
  return sources;
}
