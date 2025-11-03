// Cloudflare Workers 互換モードでは FinalizationRegistry が未実装なため、最低限の代替を用意
if (typeof globalThis.FinalizationRegistry === "undefined") {
  type CleanupCallback = (heldValue: unknown) => void

  class NoopFinalizationRegistry<T> {
    // コールバックは保持のみで利用しない（GC連動は不可）
    private readonly cleanup: CleanupCallback
    private readonly registry = new Map<T, unknown>()

    constructor(cleanup: CleanupCallback) {
      this.cleanup = cleanup
    }

    register(target: object, heldValue: T, unregisterToken?: object): void {
      this.registry.set(heldValue, unregisterToken ?? target)
    }

    unregister(unregisterToken: object): boolean {
      for (const [heldValue, token] of this.registry.entries()) {
        if (token === unregisterToken) {
          this.registry.delete(heldValue)
          return true
        }
      }
      return false
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).FinalizationRegistry = NoopFinalizationRegistry
}

// Cloudflare Workers では new Function が禁止されているため、js gem が利用する最小限のケースのみ許可する
const allowedFunctionBodies = new Map<string, (...fnArgs: unknown[]) => unknown>([
  ["return undefined", (..._args: unknown[]) => undefined],
  ["return null", (..._args: unknown[]) => null],
  ["return true;", (..._args: unknown[]) => true],
  ["return false;", (..._args: unknown[]) => false],
  // js gem が配列を変換するために利用する
  ["return []", (..._args: unknown[]) => []],
])

if (typeof globalThis.Function === "function") {
  const OriginalFunction = globalThis.Function

  const FunctionStub = function (...args: string[]): (...fnArgs: unknown[]) => unknown {
    if (args.length > 0) {
      const body = args[args.length - 1]
      const handler = allowedFunctionBodies.get(body)
      if (handler) {
        return handler
      }
    }
    throw new Error("Dynamic code generation is not permitted")
  }

  Object.setPrototypeOf(FunctionStub, OriginalFunction)
  FunctionStub.prototype = OriginalFunction.prototype

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Function = FunctionStub
}
