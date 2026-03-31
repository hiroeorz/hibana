import type { Env } from "../env"
import { ensureRecord, wrapHostOperation } from "../runtime-types"
import type { WorkersAiPayload } from "../runtime-types"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerWorkersAiHostFunction(host: HostGlobals, env: Env): void {
  assignHostFnOnce(host, "tsWorkersAiInvoke", () => {
    return async (payloadJson: string): Promise<string> => {
      return wrapHostOperation(async () => {
        const payload = parseWorkersAiPayload(payloadJson)
        const { bindingName, target } = resolveWorkersAiTarget(env, payload)
        const { methodName, methodRef } = resolveWorkersAiMethod(target, bindingName, payload)
        const args = resolveWorkersAiArgs(methodName, payload)
        return await Reflect.apply(methodRef, target, args)
      }, env)
    }
  })
}

function parseWorkersAiPayload(payloadJson: string): Record<string, unknown> {
  const payload = JSON.parse(payloadJson) as WorkersAiPayload
  if (!payload || typeof payload !== "object") {
    throw new Error("Workers AI payload must be an object")
  }
  return payload as Record<string, unknown>
}

function resolveWorkersAiTarget(
  env: Env,
  payload: Record<string, unknown>,
): { bindingName: string; target: Record<string, unknown> } {
  const bindingValue = payload["binding"]
  const bindingName =
    typeof bindingValue === "string" && bindingValue.length > 0
      ? bindingValue
      : null
  if (!bindingName) {
    throw new Error("Workers AI payload is missing a binding name")
  }
  const target = (env as Record<string, unknown>)[bindingName]
  if (!target || typeof target !== "object") {
    throw new Error(`Binding '${bindingName}' is not available`)
  }
  return { bindingName, target: target as Record<string, unknown> }
}

function resolveWorkersAiMethod(
  target: Record<string, unknown>,
  bindingName: string,
  payload: Record<string, unknown>,
): {
  methodName: string
  methodRef: (...methodArgs: unknown[]) => unknown
} {
  const methodValue = payload["method"]
  const methodName =
    typeof methodValue === "string" && methodValue.length > 0
      ? methodValue
      : "run"
  const methodRef = target[methodName]
  if (typeof methodRef !== "function") {
    throw new Error(`Method '${methodName}' is not available on '${bindingName}'`)
  }
  return {
    methodName,
    methodRef: methodRef as (...methodArgs: unknown[]) => unknown,
  }
}

function resolveWorkersAiArgs(
  methodName: string,
  payload: Record<string, unknown>,
): unknown[] {
  const argsValue = payload["args"]
  if (Array.isArray(argsValue)) {
    return argsValue as unknown[]
  }
  return buildDefaultWorkersAiArgs(methodName, payload)
}

function buildDefaultWorkersAiArgs(
  methodName: string,
  payload: Record<string, unknown>,
): unknown[] {
  const modelValue = payload["model"]
  const model =
    typeof modelValue === "string" && modelValue.length > 0
      ? modelValue
      : undefined

  if (methodName === "run") {
    if (!model) {
      throw new Error("Workers AI payload requires a model name")
    }
    const inputs = ensureRecord(payload["payload"], "payload")
    return [model, inputs]
  }

  if (model !== undefined) {
    const hasPayload = Object.prototype.hasOwnProperty.call(payload, "payload")
    const extraArgs = hasPayload ? [payload["payload"]] : []
    return [model, ...extraArgs]
  }

  if (Object.prototype.hasOwnProperty.call(payload, "payload")) {
    return [payload["payload"]]
  }

  return []
}
