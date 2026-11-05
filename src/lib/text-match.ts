/** Fuzzy product-name matching, shared by the server (product search) and the app (seal check). */
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !['the', 'and', 'with', 'for', 'oz', 'fl', 'ct', 'pack', 'count'].includes(t));

/** Share of the words in `wanted` that appear in `candidate` (0–1). Guards name searches against wrong matches. */
export function overlap(wanted: string, candidate: string) {
  const w = tokens(wanted);
  if (!w.length) return 0;
  const c = new Set(tokens(candidate));
  return w.filter((t) => c.has(t) || [...c].some((x) => x.startsWith(t) || t.startsWith(x))).length / w.length;
}
