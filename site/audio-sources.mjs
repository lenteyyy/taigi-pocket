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
