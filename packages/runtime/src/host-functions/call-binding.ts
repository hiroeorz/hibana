import type { Env } from "../env"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerCallBindingHostFunction(host: HostGlobals, env: Env): void {
  assignHostFnOnce(host, "tsCallBinding", () => {
    return async (
      binding: string,
      method: string,
      args: unknown[],
    ): Promise<unknown> => {
      const target = (env as Record<string, unknown>)[binding]
      if (!target || typeof target !== "object") {
        throw new Error(`Binding '${binding}' is not available`)
      }
      const targetMethod = (target as Record<string, unknown>)[method]
      if (typeof targetMethod !== "function") {
        throw new Error(`Method '${method}' is not available on '${binding}'`)
      }
      const result = await Reflect.apply(
        targetMethod as (...methodArgs: unknown[]) => unknown,
        target,
        args,
      )
      if (result === undefined) {
        return null
      }
      return result
    }
  })
}
