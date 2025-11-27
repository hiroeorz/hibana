import type { Env } from "../env"
import { buildHostErrorPayload } from "../runtime-types"
import type { VectorizeInvokePayload } from "../runtime-types"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerVectorizeHostFunction(host: HostGlobals, env: Env): void {
  assignHostFnOnce(host, "tsVectorizeInvoke", () => {
    return async (payloadJson: string): Promise<string> => {
      try {
        const payload = parseVectorizePayload(payloadJson)
        const binding = resolveVectorizeBinding(env, payload)
        const result = await dispatchVectorizeAction(binding, payload)
        return JSON.stringify({ ok: true, result })
      } catch (rawError) {
        return JSON.stringify({
          ok: false,
          error: buildHostErrorPayload(rawError, env),
        })
      }
    }
  })
}

function parseVectorizePayload(payloadJson: string): VectorizeInvokePayload {
  const payload = JSON.parse(payloadJson) as VectorizeInvokePayload
  if (!payload || typeof payload !== "object") {
    throw new Error("Vectorize payload must be an object")
  }
  return payload
}

function resolveVectorizeBinding(
  env: Env,
  payload: VectorizeInvokePayload,
): { bindingName: string; client: Record<string, unknown> } {
  const bindingValue = payload.binding
  const bindingName =
    typeof bindingValue === "string" && bindingValue.length > 0
      ? bindingValue
      : null
  if (!bindingName) {
    throw new Error("Vectorize payload is missing a binding name")
  }
  const client = (env as Record<string, unknown>)[bindingName]
  if (!client || typeof client !== "object") {
    throw new Error(`Binding '${bindingName}' is not available`)
  }
  return { bindingName, client: client as Record<string, unknown> }
}

function dispatchVectorizeAction(
  binding: { bindingName: string; client: Record<string, unknown> },
  payload: VectorizeInvokePayload,
): unknown {
  const action = typeof payload.action === "string" ? payload.action : ""
  const params = ensureVectorizeParams(payload.params)
  switch (action) {
    case "upsert":
      return callVectorizeMethod(binding, "upsert", [
        requireArray(params, "vectors"),
      ])
    case "query":
      return callVectorizeMethod(binding, "query", buildVectorizeQueryArgs(params))
    case "delete":
      return callVectorizeMethod(binding, "delete", [
        requireArray(params, "ids"),
      ])
    default:
      throw new Error(`Unsupported Vectorize action '${action}'`)
  }
}

function callVectorizeMethod(
  binding: { bindingName: string; client: Record<string, unknown> },
  methodName: string,
  args: unknown[],
): unknown {
  const method = binding.client[methodName]
  if (typeof method !== "function") {
    throw new Error(`Method '${methodName}' is not available on '${binding.bindingName}'`)
  }
  return Reflect.apply(method as (...methodArgs: unknown[]) => unknown, binding.client, args)
}

function requireArray(value: Record<string, unknown>, key: string): unknown[] {
  const raw = value[key]
  if (!Array.isArray(raw)) {
    throw new Error(`Vectorize payload is missing required array '${key}'`)
  }
  return raw
}

function ensureVectorizeParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {}
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error("Vectorize payload 'params' must be provided as an object")
}

function buildVectorizeQueryArgs(
  params: Record<string, unknown>,
): [unknown[], Record<string, unknown>?] {
  const vector = requireArray(params, "vector")
  const options: Record<string, unknown> = {}

  if ("topK" in params) {
    options.topK = requirePositiveInteger(params, "topK")
  }
  if ("includeMetadata" in params) {
    options.includeMetadata = Boolean(params["includeMetadata"])
  }
  if ("includeValues" in params) {
    options.includeValues = Boolean(params["includeValues"])
  }
  if ("filter" in params && params["filter"] !== undefined) {
    const filter = params["filter"]
    if (filter && typeof filter === "object" && !Array.isArray(filter)) {
      options.filter = filter
    } else {
      throw new Error("Vectorize payload 'filter' must be an object when provided")
    }
  }

  if (Object.keys(options).length === 0) {
    return [vector]
  }
  return [vector, options]
}

function requirePositiveInteger(value: Record<string, unknown>, key: string): number {
  const raw = value[key]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Vectorize payload '${key}' must be a positive integer`)
  }
  return parsed
}
