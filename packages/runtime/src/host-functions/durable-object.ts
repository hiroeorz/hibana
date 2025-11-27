import type { Env } from "../env"
import { wrapHostOperation } from "../runtime-types"
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
    return async (stateHandle: string, payloadJson: string): Promise<string> => {
      return wrapHostOperation(async () => {
        const payload = JSON.parse(payloadJson) as DurableObjectStorageOpPayload
        return await runDurableObjectStorageOp(stateHandle, payload)
      })
    }
  })

  assignHostFnOnce(host, "tsDurableObjectAlarmOp", () => {
    return async (stateHandle: string, payloadJson: string): Promise<string> => {
      return wrapHostOperation(async () => {
        const payload = JSON.parse(payloadJson) as DurableObjectAlarmOpPayload
        return await runDurableObjectAlarmOp(stateHandle, payload)
      })
    }
  })

  assignHostFnOnce(host, "tsDurableObjectStubFetch", () => {
    return async (payloadJson: string): Promise<string> => {
      return wrapHostOperation(async () => {
        const payload = JSON.parse(payloadJson) as DurableObjectStubFetchPayload
        return await runDurableObjectStubFetch(env, payload)
      })
    }
  })
}
