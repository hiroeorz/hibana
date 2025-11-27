import type { Env } from "../env"
import { buildHostErrorPayload, HOST_ERROR_GENERIC_MESSAGE } from "../runtime-types"
import {
  executeHttpFetch,
  parseHttpRequestPayload,
  type HttpFetchResponsePayload,
} from "../http-fetch-utils"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerHttpFetchHostFunction(
  host: HostGlobals,
  env: Env,
  redactHostErrors: boolean,
): void {
  assignHostFnOnce(host, "tsHttpFetch", () => {
    return async (payloadJson: string): Promise<string> => {
      try {
        const payload = parseHttpRequestPayload(payloadJson)
        const result = await executeHttpFetch(payload, {
          redactStack: redactHostErrors,
          genericMessage: HOST_ERROR_GENERIC_MESSAGE,
        })
        return JSON.stringify(result)
      } catch (rawError) {
        const fallback: HttpFetchResponsePayload = {
          ok: false,
          error: buildHostErrorPayload(rawError, env),
        }
        return JSON.stringify(fallback)
      }
    }
  })
}
