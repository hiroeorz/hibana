import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser"
import type { RubyVM, RbValue } from "@ruby/wasm-wasi"
import rubyWasmAsset from "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"
import type { Env } from "./env"
import hostBridgeScript from "./ruby/app/hibana/host_bridge.rb"
import templateRendererScript from "./ruby/app/hibana/template_renderer.rb"
import contextScript from "./ruby/app/hibana/context.rb"
import durableObjectScript from "./ruby/app/hibana/durable_object.rb"
import cronScript from "./ruby/app/hibana/cron.rb"
import kvClientScript from "./ruby/app/hibana/kv_client.rb"
import queueClientScript from "./ruby/app/hibana/queue_client.rb"
import d1ClientScript from "./ruby/app/hibana/d1_client.rb"
import ormScript from "./ruby/app/hibana/orm.rb"
import r2ClientScript from "./ruby/app/hibana/r2_client.rb"
import vectorizeClientScript from "./ruby/app/hibana/vectorize_client.rb"
import httpClientScript from "./ruby/app/hibana/http_client.rb"
import workersAiClientScript from "./ruby/app/hibana/workers_ai_client.rb"
import staticServerScript from "./ruby/app/hibana/static_server.rb"
import routingScript from "./ruby/app/hibana/routing.rb"
import htmlRewriterScript from "./ruby/app/hibana/html_rewriter.rb"
import { getHelperScripts } from "./helper-registry"
import { getApplicationScripts } from "./script-registry"
import { getTemplateAssets } from "./template-registry"
import { getStaticAssets } from "./static-registry"
import { toRubyStringLiteral } from "./ruby-utils"
import {
  registerDurableObjectState,
  type DurableObjectMetadata,
  type DurableObjectStateLike,
} from "./durable-object-host"
import { registerHostFunctions } from "./host-functions"
import { QueueHandleManager } from "./queue-handle-manager"
import {
  type WorkerResponsePayload,
  type RuntimeScheduledEvent,
  type QueueMessageBatch,
  METHODS_WITH_BODY,
} from "./runtime-types"

export type { RuntimeScheduledEvent, WorkerResponsePayload }

let rubyVmPromise: Promise<RubyVM> | null = null
let sharedQueueManager: QueueHandleManager | null = null

function getQueueManager(): QueueHandleManager {
  if (!sharedQueueManager) {
    sharedQueueManager = new QueueHandleManager()
  }
  return sharedQueueManager
}

async function setupRubyVM(env: Env): Promise<RubyVM> {
  if (!rubyVmPromise) {
    rubyVmPromise = (async () => {
      const moduleCandidate = rubyWasmAsset as unknown
      const module =
        moduleCandidate instanceof WebAssembly.Module
          ? moduleCandidate
          : await WebAssembly.compile(moduleCandidate as ArrayBuffer)

      const { vm } = await DefaultRubyVM(module, {
        consolePrint: true,
        env: {
          RUBYOPT: "--disable-did_you_mean",
        },
      })

      // Load order is important: HostBridge must be loaded first,
      // then host functions registered, before other clients can use them.
      await evalRubyFile(vm, hostBridgeScript, "app/hibana/host_bridge.rb")
      registerHostFunctions(vm, env, getQueueManager())
      await evalRubyFile(vm, templateRendererScript, "app/hibana/template_renderer.rb")
      await evalRubyFile(vm, contextScript, "app/hibana/context.rb")
      await evalRubyFile(vm, durableObjectScript, "app/hibana/durable_object.rb")
      await evalRubyFile(vm, cronScript, "app/hibana/cron.rb")
      await evalRubyFile(vm, kvClientScript, "app/hibana/kv_client.rb")
      await evalRubyFile(vm, queueClientScript, "app/hibana/queue_client.rb")
      await evalRubyFile(vm, d1ClientScript, "app/hibana/d1_client.rb")
      await evalRubyFile(vm, ormScript, "app/hibana/orm.rb")
      await evalRubyFile(vm, r2ClientScript, "app/hibana/r2_client.rb")
      await evalRubyFile(vm, vectorizeClientScript, "app/hibana/vectorize_client.rb")
      await evalRubyFile(vm, httpClientScript, "app/hibana/http_client.rb")
      await evalRubyFile(vm, workersAiClientScript, "app/hibana/workers_ai_client.rb")
      await evalRubyFile(vm, staticServerScript, "app/hibana/static_server.rb")
      await evalRubyFile(vm, htmlRewriterScript, "app/hibana/html_rewriter.rb")
      await registerTemplates(vm)
      await registerStaticAssets(vm)

      for (const helper of getHelperScripts()) {
        await evalRubyFile(vm, helper.source, helper.filename)
      }

      await evalRubyFile(vm, routingScript, "app/hibana/routing.rb")

      for (const script of getApplicationScripts()) {
        await evalRubyFile(vm, script.source, script.filename)
      }

      return vm
    })()
  }
  return rubyVmPromise
}

export async function handleRequest(
  env: Env,
  request: Request,
): Promise<WorkerResponsePayload> {
  const vm = await setupRubyVM(env)
  const url = new URL(request.url)
  const pathname = url.pathname

  const context = vm.eval("RequestContext.new")
  const headersJson = JSON.stringify(buildHeadersObject(request.headers))
  const queryJson = JSON.stringify(buildQueryObject(url.searchParams))
  const headersArg = vm.eval(toRubyStringLiteral(headersJson))
  const queryArg = vm.eval(toRubyStringLiteral(queryJson))
  const methodArg = vm.eval(toRubyStringLiteral(request.method))
  const pathArg = vm.eval(toRubyStringLiteral(pathname))
  const urlArg = vm.eval(toRubyStringLiteral(request.url))
  contextCall(context, "set_request_headers", headersArg)
  contextCall(context, "set_request_method", methodArg)
  contextCall(context, "set_request_path", pathArg)
  contextCall(context, "set_request_url", urlArg)
  contextCall(context, "set_query_from_json", queryArg)
  await populateBodyOnContext(context, request, vm)
  const dispatcher = vm.eval("method(:dispatch)")
  const result = await dispatcher.callAsync("call", methodArg, pathArg, context)
  const serialized = result.toString()
  return parseRubyResponsePayload(serialized)
}

export async function handleScheduled(
  env: Env,
  event: RuntimeScheduledEvent,
): Promise<void> {
  const vm = await setupRubyVM(env)
  const dispatcher = vm.eval("method(:dispatch_scheduled)")
  const payloadJson = JSON.stringify(buildScheduledPayload(event))
  const payloadArg = vm.eval(toRubyStringLiteral(payloadJson))
  const result = await dispatcher.callAsync("call", payloadArg)
  const serialized =
    result && typeof result.toString === "function" ? result.toString() : ""
  if (!serialized) {
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown JSON parse error"
    throw new Error(
      `Failed to parse Ruby cron response payload: ${reason}\nPayload: ${serialized}`,
    )
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Ruby cron response payload is malformed")
  }

  const payload = parsed as {
    status?: string
    error?: { message?: string }
  }

  if (payload.status === "error") {
    const message =
      payload.error?.message ||
      "Ruby cron handler failed without an error message"
    throw new Error(message)
  }
}

export async function handleQueue(
  env: Env,
  batch: QueueMessageBatch<unknown>,
  bindingName?: string | null,
): Promise<void> {
  const vm = await setupRubyVM(env)
  const queueManager = getQueueManager()
  const dispatcher = vm.eval("Hibana::Queues")
  const { batchHandle, payload } = queueManager.registerBatch(batch, bindingName)
  const bindingArg =
    bindingName && bindingName.toString().length > 0
      ? vm.eval(toRubyStringLiteral(bindingName.toString()))
      : vm.eval("nil")
  const payloadJson = JSON.stringify(payload)
  const payloadArg = vm.eval(toRubyStringLiteral(payloadJson))
  try {
    const result = await dispatcher.callAsync(
      "dispatch_queue",
      bindingArg,
      payloadArg,
    )
    const serialized =
      result && typeof result.toString === "function" ? result.toString() : ""
    if (!serialized) {
      return
    }
    parseQueueResponse(serialized)
  } finally {
    queueManager.cleanupBatch(batchHandle)
  }
}

export async function handleDurableObjectFetch(
  bindingName: string,
  stateHandle: string,
  metadata: DurableObjectMetadata,
  request: Request,
  env: Env,
): Promise<WorkerResponsePayload> {
  const vm = await setupRubyVM(env)
  const context = await createDurableObjectRequestContext(vm, request)
  const dispatcher = vm.eval("Hibana::DurableObjects")
  const bindingArg = vm.eval(toRubyStringLiteral(bindingName))
  const stateArg = vm.eval(toRubyStringLiteral(stateHandle))
  const metadataJson = JSON.stringify(metadata ?? {})
  const metadataArg = vm.eval(toRubyStringLiteral(metadataJson))
  const result = await dispatcher.callAsync(
    "dispatch_fetch",
    bindingArg,
    stateArg,
    metadataArg,
    context,
  )
  const serialized = result.toString()
  return parseRubyResponsePayload(serialized)
}

export async function handleDurableObjectAlarm(
  bindingName: string,
  stateHandle: string,
  metadata: DurableObjectMetadata,
  env: Env,
): Promise<void> {
  const vm = await setupRubyVM(env)
  const dispatcher = vm.eval("Hibana::DurableObjects")
  const bindingArg = vm.eval(toRubyStringLiteral(bindingName))
  const stateArg = vm.eval(toRubyStringLiteral(stateHandle))
  const metadataJson = JSON.stringify(metadata ?? {})
  const metadataArg = vm.eval(toRubyStringLiteral(metadataJson))
  await dispatcher.callAsync("dispatch_alarm", bindingArg, stateArg, metadataArg)
}

export function createDurableObjectClass(
  bindingName: string,
): new (state: DurableObjectStateLike, env: Env) => {
  fetch(request: Request): Promise<Response>
  alarm(): Promise<void>
} {
  const normalizedBinding = bindingName.toString()
  return class HibanaDurableObjectBridge {
    private readonly stateHandle: string
    private readonly metadata: DurableObjectMetadata

    constructor(
      private readonly state: DurableObjectStateLike,
      private readonly env: Env,
    ) {
      const registration = registerDurableObjectState(normalizedBinding, state)
      this.stateHandle = registration.handle
      this.metadata = registration.metadata
    }

    async fetch(request: Request): Promise<Response> {
      try {
        const payload = await handleDurableObjectFetch(
          normalizedBinding,
          this.stateHandle,
          this.metadata,
          request,
          this.env,
        )
        return new Response(payload.body, {
          status: payload.status,
          headers: payload.headers,
        })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown Durable Object error"
        return new Response(`Ruby Durable Object error: ${message}`, {
          status: 500,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        })
      }
    }

    async alarm(): Promise<void> {
      await handleDurableObjectAlarm(
        normalizedBinding,
        this.stateHandle,
        this.metadata,
        this.env,
      )
    }
  }
}

function parseRubyResponsePayload(serialized: string): WorkerResponsePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown JSON parse error"
    throw new Error(
      `Failed to parse Ruby response payload: ${reason}\nPayload: ${serialized}`,
    )
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("body" in parsed) ||
    !("status" in parsed) ||
    !("headers" in parsed)
  ) {
    throw new Error("Ruby response payload is malformed")
  }

  const payload = parsed as {
    body: unknown
    status: unknown
    headers: Record<string, unknown>
  }

  const headers: Record<string, string> = {}
  if (payload.headers && typeof payload.headers === "object") {
    for (const [key, value] of Object.entries(payload.headers)) {
      if (value === undefined || value === null) {
        continue
      }
      headers[key] = typeof value === "string" ? value : String(value)
    }
  }

  const body =
    typeof payload.body === "string" ? payload.body : String(payload.body ?? "")
  const status =
    typeof payload.status === "number"
      ? payload.status
      : Number(payload.status ?? 200)

  return { body, status, headers }
}

function buildHeadersObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function buildQueryObject(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  searchParams.forEach((_value, key) => {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      return
    }
    const values = searchParams.getAll(key)
    query[key] = values.length > 1 ? values : values[0] ?? ""
  })
  return query
}

function buildScheduledPayload(
  event: RuntimeScheduledEvent,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    cron: event.cron ?? "",
  }

  if (typeof event.scheduledTime === "number") {
    payload.scheduledTime = event.scheduledTime
    payload.scheduled_time = event.scheduledTime
  }

  if (event.type !== undefined) {
    payload.type = event.type
  }

  if (event.retryCount !== undefined) {
    payload.retryCount = event.retryCount
    payload.retry_count = event.retryCount
  }

  if (event.noRetry !== undefined) {
    payload.noRetry = event.noRetry
    payload.no_retry = event.noRetry
  }

  return payload
}

function parseQueueResponse(serialized: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown JSON parse error"
    throw new Error(
      `Failed to parse Ruby queue response payload: ${reason}\nPayload: ${serialized}`,
    )
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Ruby queue response payload is malformed")
  }

  const payload = parsed as {
    status?: string
    error?: { message?: string }
    queue?: string
  }

  if (payload.status === "error") {
    const message =
      payload.error?.message ||
      "Ruby queue handler failed without an error message"
    throw new Error(message)
  }

  if (payload.status === "no_handler") {
    const queueName = payload.queue || "unknown"
    console.warn(
      `[Hibana][queue] No Ruby handler matched queue '${queueName}'. Define queue binding: ... do |batch| end to handle it.`,
    )
  }
}

async function populateBodyOnContext(
  context: RbValue,
  request: Request,
  vm: RubyVM,
): Promise<void> {
  const method = request.method.toUpperCase()
  if (!METHODS_WITH_BODY.includes(method as (typeof METHODS_WITH_BODY)[number])) {
    contextCall(context, "set_raw_body", vm.eval('""'))
    contextCall(context, "set_json_body", vm.eval("nil"))
    contextCall(context, "set_form_body", vm.eval("nil"))
    contextCall(context, "set_content_type", vm.eval("nil"))
    return
  }

  const contentType = request.headers.get("content-type") ?? ""
  contextCall(context, "set_content_type", vm.eval(toRubyStringLiteral(contentType)))

  const hasJSON = contentType.includes("application/json")
  const hasForm = contentType.includes("application/x-www-form-urlencoded")

  const rawBody = await request.clone().text()
  contextCall(context, "set_raw_body", vm.eval(toRubyStringLiteral(rawBody)))

  if (hasJSON && rawBody.length > 0) {
    contextCall(context, "set_json_body", vm.eval(toRubyStringLiteral(rawBody)))
  } else {
    contextCall(context, "set_json_body", vm.eval("nil"))
  }

  if (hasForm && rawBody.length > 0) {
    const formData = buildQueryObject(new URLSearchParams(rawBody))
    const formJson = JSON.stringify(formData)
    contextCall(context, "set_form_body", vm.eval(toRubyStringLiteral(formJson)))
  } else {
    contextCall(context, "set_form_body", vm.eval("nil"))
  }
}

async function createDurableObjectRequestContext(
  vm: RubyVM,
  request: Request,
): Promise<RbValue> {
  const context = vm.eval("RequestContext.new")
  const url = new URL(request.url)
  const headersJson = JSON.stringify(buildHeadersObject(request.headers))
  const queryJson = JSON.stringify(buildQueryObject(url.searchParams))
  const headersArg = vm.eval(toRubyStringLiteral(headersJson))
  const queryArg = vm.eval(toRubyStringLiteral(queryJson))
  const methodArg = vm.eval(toRubyStringLiteral(request.method))
  const pathArg = vm.eval(toRubyStringLiteral(url.pathname))
  const urlArg = vm.eval(toRubyStringLiteral(request.url))
  contextCall(context, "set_request_headers", headersArg)
  contextCall(context, "set_request_method", methodArg)
  contextCall(context, "set_request_path", pathArg)
  contextCall(context, "set_request_url", urlArg)
  contextCall(context, "set_query_from_json", queryArg)
  await populateBodyOnContext(context, request, vm)
  return context
}

function contextCall(context: RbValue, method: string, arg: unknown): void {
  if (
    typeof context === "object" &&
    context !== null &&
    typeof (context as { call?: (...args: unknown[]) => unknown }).call === "function"
  ) {
    ;(context as { call: (...args: unknown[]) => unknown }).call(method, arg)
  }
}

async function evalRubyFile(vm: RubyVM, source: string, filename: string): Promise<void> {
  const wrappedSource = wrapRubySourceForEval(source, filename)
  await vm.evalAsync(wrappedSource)
}

function wrapRubySourceForEval(source: string, filename: string): string {
  const heredocId = createUniqueHeredocId(source)
  const quotedFilename = JSON.stringify(filename)
  return `eval(<<'${heredocId}', TOPLEVEL_BINDING, ${quotedFilename}, 1)\n${source}\n${heredocId}\n`
}

function createUniqueHeredocId(source: string): string {
  let base = "__CFW_RUBY_SOURCE__"
  while (source.includes(base)) {
    base += "_"
  }
  return base
}

async function registerTemplates(vm: RubyVM): Promise<void> {
  const templates = getTemplateAssets()
  await vm.evalAsync("Hibana::TemplateRegistry.clear")

  if (templates.length === 0) {
    return
  }

  for (const template of templates) {
    const filenameLiteral = toRubyStringLiteral(template.filename)
    const sourceLiteral = toRubyStringLiteral(template.source)
    const script = `Hibana::TemplateRegistry.register(${filenameLiteral}, ${sourceLiteral})`
    await vm.evalAsync(script)
  }
}

async function registerStaticAssets(vm: RubyVM): Promise<void> {
  const assets = getStaticAssets()
  await vm.evalAsync("Hibana::StaticRegistry.clear")

  if (assets.length === 0) {
    return
  }

  for (const asset of assets) {
    const filenameLiteral = toRubyStringLiteral(asset.filename)
    const bodyLiteral = toRubyStringLiteral(asset.body)
    const contentTypeLiteral = asset.contentType
      ? toRubyStringLiteral(asset.contentType)
      : "nil"
    const script = `Hibana::StaticRegistry.register(${filenameLiteral}, ${bodyLiteral}, ${contentTypeLiteral})`
    await vm.evalAsync(script)
  }
}
