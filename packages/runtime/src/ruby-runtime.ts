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
import d1ClientScript from "./ruby/app/hibana/d1_client.rb"
import ormScript from "./ruby/app/hibana/orm.rb"
import r2ClientScript from "./ruby/app/hibana/r2_client.rb"
import httpClientScript from "./ruby/app/hibana/http_client.rb"
import workersAiClientScript from "./ruby/app/hibana/workers_ai_client.rb"
import staticServerScript from "./ruby/app/hibana/static_server.rb"
import routingScript from "./ruby/app/hibana/routing.rb"
import htmlRewriterScript from "./ruby/app/hibana/html_rewriter.rb"
import {
  executeHttpFetch,
  parseHttpRequestPayload,
  type HttpFetchResponsePayload,
} from "./http-fetch-utils"
import { getHelperScripts } from "./helper-registry"
import { getApplicationScripts } from "./script-registry"
import { getTemplateAssets } from "./template-registry"
import { getStaticAssets } from "./static-registry"
import { transformHtmlWithRubyHandlers } from "./html-rewriter-bridge"
import { toRubyStringLiteral } from "./ruby-utils"
import {
  registerDurableObjectState,
  runDurableObjectStorageOp,
  runDurableObjectAlarmOp,
  type DurableObjectMetadata,
  type DurableObjectStateLike,
  type DurableObjectStorageOpPayload,
  type DurableObjectAlarmOpPayload,
} from "./durable-object-host"

type HostGlobals = typeof globalThis & {
  tsCallBinding?: (
    binding: string,
    method: string,
    args: unknown[],
  ) => Promise<unknown>
  tsRunD1Query?: (
    binding: string,
    sql: string,
    bindings: unknown[],
    action: "first" | "all" | "run",
  ) => Promise<string>
  tsHttpFetch?: (payloadJson: string) => Promise<string>
  tsWorkersAiInvoke?: (payloadJson: string) => Promise<string>
  tsReportRubyError?: (payloadJson: string) => Promise<void>
  tsHtmlRewriterTransform?: (payloadJson: string) => Promise<string>
  tsDurableObjectStorageOp?: (
    stateHandle: string,
    payloadJson: string,
  ) => Promise<string>
  tsDurableObjectAlarmOp?: (
    stateHandle: string,
    payloadJson: string,
  ) => Promise<string>
}

interface WorkerResponsePayload {
  body: string
  status: number
  headers: Record<string, string>
}

export interface RuntimeScheduledEvent {
  cron: string
  scheduledTime: number
  type?: string
  retryCount?: number
  noRetry?: boolean
  [key: string]: unknown
}

type D1PreparedStatement = {
  bind: (...args: unknown[]) => D1PreparedStatement
  first: () => Promise<unknown>
  all: () => Promise<{ results: unknown } | unknown>
  run: () => Promise<unknown>
}

type WorkersAiPayload = {
  binding: string
  method?: string
  args?: unknown[]
  model?: string
  payload?: unknown
  [key: string]: unknown
}

let rubyVmPromise: Promise<RubyVM> | null = null

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

      // 順序が重要
      await evalRubyFile(vm, hostBridgeScript, "app/hibana/host_bridge.rb") // 1. ブリッジ
      registerHostFunctions(vm, env) // 2. ブリッジに関数を登録
      await evalRubyFile(vm, templateRendererScript, "app/hibana/template_renderer.rb") // 3. テンプレート
      await evalRubyFile(vm, contextScript, "app/hibana/context.rb") // 4. コンテキスト
      await evalRubyFile(vm, durableObjectScript, "app/hibana/durable_object.rb") // 5. Durable Object DSL
      await evalRubyFile(vm, cronScript, "app/hibana/cron.rb") // 6. Cron DSL
      await evalRubyFile(vm, kvClientScript, "app/hibana/kv_client.rb") // 7. KVクライアント
      await evalRubyFile(vm, d1ClientScript, "app/hibana/d1_client.rb") // 8. D1クライアント
      await evalRubyFile(vm, ormScript, "app/hibana/orm.rb") // 9. ORM
      await evalRubyFile(vm, r2ClientScript, "app/hibana/r2_client.rb") // 10. R2クライアント
      await evalRubyFile(vm, httpClientScript, "app/hibana/http_client.rb") // 11. HTTPクライアント
      await evalRubyFile(vm, workersAiClientScript, "app/hibana/workers_ai_client.rb") // 12. Workers AIクライアント
      await evalRubyFile(vm, staticServerScript, "app/hibana/static_server.rb") // 13. 静的サーバー
      await evalRubyFile(vm, htmlRewriterScript, "app/hibana/html_rewriter.rb") // 14. HTMLRewriter
      await registerTemplates(vm) // 15. テンプレート資材をロード
      await registerStaticAssets(vm) // 16. 静的アセットをロード

      // 17. app/helpers 以下のファイルを順次読み込み
      for (const helper of getHelperScripts()) {
        await evalRubyFile(vm, helper.source, helper.filename) // app/helpers配下
      }

      await evalRubyFile(vm, routingScript, "app/hibana/routing.rb") // 18. ルーティングDSL

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

function registerHostFunctions(vm: RubyVM, env: Env): void {
  const host = globalThis as HostGlobals

  if (typeof host.tsCallBinding !== "function") {
    host.tsCallBinding = async (
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
  }

  // D1クエリを実行する汎用的な非同期関数
  if (typeof host.tsRunD1Query !== "function") {
    host.tsRunD1Query = async (
      binding: string,
      sql: string,
      bindings: unknown[],
      action: "first" | "all" | "run",
    ): Promise<string> => {
      try {
        const db = (env as Record<string, unknown>)[binding]
        if (!db || typeof db !== "object") {
          throw new Error(`Binding '${binding}' is not available`)
        }
        const prepare = (db as Record<string, unknown>).prepare
        if (typeof prepare !== "function") {
          throw new Error(`Binding '${binding}' does not support prepare`)
        }
        const stmt = Reflect.apply(prepare, db, [sql]) as D1PreparedStatement
        const bindingsArray = Array.isArray(bindings) ? bindings : [bindings]
        const bindMethod = stmt.bind
        if (typeof bindMethod !== "function") {
          throw new Error(`Statement for '${binding}' does not support bind`)
        }
        const preparedStmt = Reflect.apply(
          bindMethod,
          stmt,
          bindingsArray,
        ) as D1PreparedStatement
        let results
        const firstMethod = preparedStmt.first
        const allMethod = preparedStmt.all
        const runMethod = preparedStmt.run
        switch (action) {
          case "first":
            if (typeof firstMethod !== "function") {
              throw new Error(`Statement for '${binding}' does not support first`)
            }
            results = await Reflect.apply(firstMethod, preparedStmt, [])
            break
          case "all":
            if (typeof allMethod !== "function") {
              throw new Error(`Statement for '${binding}' does not support all`)
            }
            const allResult = await Reflect.apply(allMethod, preparedStmt, [])
            results =
              typeof allResult === "object" && allResult && "results" in allResult
                ? (allResult as { results: unknown }).results
                : allResult
            break
          case "run":
            if (typeof runMethod !== "function") {
              throw new Error(`Statement for '${binding}' does not support run`)
            }
            results = await Reflect.apply(runMethod, preparedStmt, [])
            break
        }
        return JSON.stringify(results)
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return JSON.stringify({ error })
      }
    }
  }

  if (typeof host.tsHttpFetch !== "function") {
    host.tsHttpFetch = async (payloadJson: string): Promise<string> => {
      try {
        const payload = parseHttpRequestPayload(payloadJson)
        const result = await executeHttpFetch(payload)
        return JSON.stringify(result)
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError))
        const fallback: HttpFetchResponsePayload = {
          ok: false,
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack,
          },
        }
        return JSON.stringify(fallback)
      }
    }
  }

  if (typeof host.tsWorkersAiInvoke !== "function") {
    host.tsWorkersAiInvoke = async (payloadJson: string): Promise<string> => {
      try {
        const payload = JSON.parse(payloadJson) as WorkersAiPayload
        if (!payload || typeof payload !== "object") {
          throw new Error("Workers AI payload must be an object")
        }
        const payloadRecord = payload as Record<string, unknown>
        const bindingValue = payloadRecord["binding"]
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
        const methodValue = payloadRecord["method"]
        const methodName =
          typeof methodValue === "string" && methodValue.length > 0
            ? methodValue
            : "run"
        const methodRef = (target as Record<string, unknown>)[methodName]
        if (typeof methodRef !== "function") {
          throw new Error(`Method '${methodName}' is not available on '${bindingName}'`)
        }
        let args: unknown[]
        const argsValue = payloadRecord["args"]
        if (Array.isArray(argsValue)) {
          args = argsValue as unknown[]
        } else {
          const modelValue = payloadRecord["model"]
          const model =
            typeof modelValue === "string" && modelValue.length > 0
              ? modelValue
              : undefined
          if (methodName === "run") {
            if (!model) {
              throw new Error("Workers AI payload requires a model name")
            }
            const inputs = ensureRecord(payloadRecord["payload"], "payload")
            args = [model, inputs]
          } else if (model !== undefined) {
            const extraArgs =
              Object.prototype.hasOwnProperty.call(payloadRecord, "payload")
                ? [payloadRecord["payload"]]
                : []
            args = [model, ...extraArgs]
          } else if (Object.prototype.hasOwnProperty.call(payloadRecord, "payload")) {
            args = [payloadRecord["payload"]]
          } else {
            args = []
          }
        }
        const result = await Reflect.apply(methodRef, target, args)
        return JSON.stringify({ ok: true, result })
      } catch (rawError) {
        const error =
          rawError instanceof Error ? rawError : new Error(String(rawError))
        return JSON.stringify({
          ok: false,
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack,
          },
        })
      }
    }
  }

  if (typeof host.tsHtmlRewriterTransform !== "function") {
    host.tsHtmlRewriterTransform = async (payloadJson: string): Promise<string> => {
      return transformHtmlWithRubyHandlers(vm, payloadJson)
    }
  }

  if (typeof host.tsDurableObjectStorageOp !== "function") {
    host.tsDurableObjectStorageOp = async (
      stateHandle: string,
      payloadJson: string,
    ): Promise<string> => {
      try {
        const payload = JSON.parse(payloadJson) as DurableObjectStorageOpPayload
        const result = await runDurableObjectStorageOp(stateHandle, payload)
        return JSON.stringify(result)
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError))
        return JSON.stringify({
          ok: false,
          error: { message: error.message, name: error.name },
        })
      }
    }
  }

  if (typeof host.tsDurableObjectAlarmOp !== "function") {
    host.tsDurableObjectAlarmOp = async (
      stateHandle: string,
      payloadJson: string,
    ): Promise<string> => {
      try {
        const payload = JSON.parse(payloadJson) as DurableObjectAlarmOpPayload
        const result = await runDurableObjectAlarmOp(stateHandle, payload)
        return JSON.stringify(result)
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError))
        return JSON.stringify({
          ok: false,
          error: { message: error.message, name: error.name },
        })
      }
    }
  }

  if (typeof host.tsReportRubyError !== "function") {
    host.tsReportRubyError = async (payloadJson: string): Promise<void> => {
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
  }

  vm.eval('require "js"')

  const HostBridge = vm.eval("HostBridge")

  HostBridge.call("ts_call_binding=", vm.wrap(host.tsCallBinding))
  HostBridge.call("ts_run_d1_query=", vm.wrap(host.tsRunD1Query))
  HostBridge.call("ts_http_fetch=", vm.wrap(host.tsHttpFetch))
  HostBridge.call("ts_workers_ai_invoke=", vm.wrap(host.tsWorkersAiInvoke))
  HostBridge.call("ts_report_ruby_error=", vm.wrap(host.tsReportRubyError))
  HostBridge.call("ts_html_rewriter_transform=", vm.wrap(host.tsHtmlRewriterTransform))
  HostBridge.call("ts_durable_object_storage_op=", vm.wrap(host.tsDurableObjectStorageOp))
  HostBridge.call("ts_durable_object_alarm_op=", vm.wrap(host.tsDurableObjectAlarmOp))
}

function ensureRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {}
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error(`Workers AI payload '${label}' must be provided as an object`)
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

async function populateBodyOnContext(
  context: RbValue,
  request: Request,
  vm: RubyVM,
): Promise<void> {
  const method = request.method.toUpperCase()
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
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
