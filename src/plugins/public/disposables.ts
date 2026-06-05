export interface Disposable {
  dispose(): void
}

export function toDisposable(dispose: () => void): Disposable {
  let disposed = false

  return {
    dispose() {
      if (disposed) {
        return
      }

      disposed = true
      dispose()
    },
  }
}

export function disposeAll(disposables: Iterable<Disposable>): void {
  for (const disposable of disposables) {
    disposable.dispose()
  }
}
