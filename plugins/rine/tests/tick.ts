declare function setTimeout(callback: () => void, ms: number): unknown

/** Yields one macrotask so timers and I/O callbacks run. */
export function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
