import type { Env } from "../env"
import { createErrorResponse } from "../runtime-types"
import {
  runDurableObjectStorageOp,
  runDurableObjectAlarmOp,
  type DurableObjectStorageOpPayload,
  type DurableObjectAlarmOpPayload,
} from "../durable-object-host"
import {
  runDurableObjectStubFetch,
  type DurableObjectStubFetchPayload,
} from "../durable-object-stub"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerDurableObjectHostFunctions(host: HostGlobals, env: Env): void {
  assignHostFnOnce(host, "tsDurableObjectStorageOp", () => {
    return async (
      stateHandle: string,
      payloadJson: string,
    ): Promise<string> => {
      try {
        const payload = JSON.parse(payloadJson) as DurableObjectStorageOpPayload
        const result = await runDurableObjectStorageOp(stateHandle, payload)
        return JSON.stringify(result)
      } catch (rawError) {
        return createErrorResponse(rawError)
      }
    }
  })

  assignHostFnOnce(host, "tsDurableObjectAlarmOp", () => {
    return async (
      stateHandle: string,
      payloadJson: string,
    ): Promise<string> => {
      try {
        const payload = JSON.parse(payloadJson) as DurableObjectAlarmOpPayload
        const result = await runDurableObjectAlarmOp(stateHandle, payload)
        return JSON.stringify(result)
      } catch (rawError) {
        return createErrorResponse(rawError)
      }
    }
  })

  assignHostFnOnce(host, "tsDurableObjectStubFetch", () => {
    return async (payloadJson: string): Promise<string> => {
      try {
        const payload = JSON.parse(payloadJson) as DurableObjectStubFetchPayload
        const result = await runDurableObjectStubFetch(env, payload)
        return JSON.stringify(result)
      } catch (rawError) {
        return createErrorResponse(rawError)
      }
    }
  })
}
