import type { RubyVM } from "@ruby/wasm-wasi"
import { transformHtmlWithRubyHandlers } from "../html-rewriter-bridge"
import { HOST_ERROR_GENERIC_MESSAGE } from "../runtime-types"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerHtmlRewriterHostFunction(
  host: HostGlobals,
  vm: RubyVM,
  redactHostErrors: boolean,
): void {
  assignHostFnOnce(host, "tsHtmlRewriterTransform", () => {
    return async (payloadJson: string): Promise<string> => {
      return transformHtmlWithRubyHandlers(vm, payloadJson, {
        redactStack: redactHostErrors,
        genericMessage: HOST_ERROR_GENERIC_MESSAGE,
      })
    }
  })
}
