import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerRubyErrorReporter(host: HostGlobals): void {
  assignHostFnOnce(host, "tsReportRubyError", () => {
    return async (payloadJson: string): Promise<void> => {
      try {
        const payload = JSON.parse(payloadJson) as {
          message?: string
          class?: string
          backtrace?: unknown
        }
        const errorClass =
          typeof payload?.class === "string" && payload.class.length > 0
            ? payload.class
            : "Error"
        const message =
          typeof payload?.message === "string" ? payload.message : ""
        const backtrace = Array.isArray(payload?.backtrace)
          ? payload.backtrace
          : []
        const backtraceText =
          backtrace.length > 0 ? `\n${backtrace.join("\n")}` : ""
        console.error(`[RubyError] ${errorClass}: ${message}${backtraceText}`)
      } catch (error) {
        console.error(
          "[RubyError] Failed to parse error payload",
          error,
          "payload:",
          payloadJson,
        )
      }
    }
  })
}
