import type { RubyVM } from "@ruby/wasm-wasi"
import type { Env } from "../env"
import type { QueueHandleManager } from "../queue-handle-manager"
import { shouldMaskHostError } from "../runtime-types"
import type { HostGlobals } from "./types"
import { registerCallBindingHostFunction } from "./call-binding"
import { registerD1HostFunction } from "./d1"
import { registerHttpFetchHostFunction } from "./http-fetch"
import { registerWorkersAiHostFunction } from "./workers-ai"
import { registerVectorizeHostFunction } from "./vectorize"
import { registerHtmlRewriterHostFunction } from "./html-rewriter"
import { registerDurableObjectHostFunctions } from "./durable-object"
import { registerQueueHostFunctions } from "./queue"
import { registerRubyErrorReporter } from "./error-reporter"

export type { HostGlobals } from "./types"

const HOST_BRIDGE_BINDINGS: Array<[string, keyof HostGlobals]> = [
  ["ts_call_binding=", "tsCallBinding"],
  ["ts_run_d1_query=", "tsRunD1Query"],
  ["ts_http_fetch=", "tsHttpFetch"],
  ["ts_workers_ai_invoke=", "tsWorkersAiInvoke"],
  ["ts_vectorize_invoke=", "tsVectorizeInvoke"],
  ["ts_report_ruby_error=", "tsReportRubyError"],
  ["ts_html_rewriter_transform=", "tsHtmlRewriterTransform"],
  ["ts_durable_object_storage_op=", "tsDurableObjectStorageOp"],
  ["ts_durable_object_alarm_op=", "tsDurableObjectAlarmOp"],
  ["ts_durable_object_stub_fetch=", "tsDurableObjectStubFetch"],
  ["ts_queue_message_op=", "tsQueueMessageOp"],
  ["ts_queue_batch_op=", "tsQueueBatchOp"],
]

export function registerHostFunctions(
  vm: RubyVM,
  env: Env,
  queueManager: QueueHandleManager,
): void {
  const host = globalThis as HostGlobals
  const redactHostErrors = shouldMaskHostError(env)

  registerCallBindingHostFunction(host, env)
  registerD1HostFunction(host, env)
  registerHttpFetchHostFunction(host, env, redactHostErrors)
  registerWorkersAiHostFunction(host, env)
  registerVectorizeHostFunction(host, env)
  registerHtmlRewriterHostFunction(host, vm, redactHostErrors)
  registerDurableObjectHostFunctions(host, env)
  registerQueueHostFunctions(host, queueManager)
  registerRubyErrorReporter(host)

  vm.eval('require "js"')
  registerHostBridgeBindings(vm, host)
}

function registerHostBridgeBindings(vm: RubyVM, host: HostGlobals): void {
  const HostBridge = vm.eval("HostBridge")
  for (const [setter, key] of HOST_BRIDGE_BINDINGS) {
    HostBridge.call(setter, vm.wrap(host[key]))
  }
}
