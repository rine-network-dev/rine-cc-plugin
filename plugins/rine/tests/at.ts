/** Indexed read that fails the test with a clear message instead of yielding undefined (noUncheckedIndexedAccess). */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index}, found ${items.length} items`)
  return item
}
