// Made By 冷踢踢
// 分類內查無詞目時擴大搜尋；過期請求不得改變目前的搜尋範圍。
export async function searchWithScope(request, params, isCurrent = () => true) {
  const scope = { q: '', mode: 'prefix', category: '', offset: 0, ...params };
  const search = (category) =>
    request('/api/search?' + new URLSearchParams({ ...scope, category }));
  if (!isCurrent()) return null;
  let result = await search(scope.category);
  if (!isCurrent()) return null;
  if (scope.q.trim() && scope.category && Number(scope.offset) === 0 && result.total === 0) {
    result = await search('');
    if (!isCurrent()) return null;
    return { result, category: '', expandedFrom: scope.category };
  }
  return { result, category: scope.category, expandedFrom: '' };
}
