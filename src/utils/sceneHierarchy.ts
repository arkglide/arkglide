/** Walk parent links without consuming the JavaScript call stack. */
export function isSceneDescendant(
  parents: ReadonlyMap<string, string | null | undefined>,
  nodeId: string,
  ancestorId: string,
): boolean {
  const seen = new Set<string>();
  let parent = parents.get(nodeId);
  while (parent) {
    if (parent === ancestorId) return true;
    if (seen.has(parent)) return false;
    seen.add(parent);
    parent = parents.get(parent);
  }
  return false;
}
