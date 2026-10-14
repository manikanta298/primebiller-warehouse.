export const searchTokens = (query: string) => query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
export const searchReady = (query: string) => query.trim().length >= 2;
export function matchesSearch(text: string, query: string) {
  return searchTokens(query).every(token => text.toLocaleLowerCase().includes(token));
}
export function searchRank(name: string, query: string) {
  return name.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase()) ? 0 : 1;
}
