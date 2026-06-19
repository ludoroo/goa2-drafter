import '@testing-library/jest-dom/vitest'

// jsdom in this Node version does not provide a working `localStorage`.
// Install a minimal in-memory implementation so storage-backed code
// (e.g. LocalGameStore) can run under test. Real browsers are unaffected.
if (typeof globalThis.localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>()

    get length(): number {
      return this.store.size
    }

    clear(): void {
      this.store.clear()
    }

    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null
    }

    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null
    }

    removeItem(key: string): void {
      this.store.delete(key)
    }

    setItem(key: string, value: string): void {
      this.store.set(key, String(value))
    }
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}
