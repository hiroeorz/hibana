import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser"
import type { RubyVM } from "@ruby/wasm-wasi"
import rubyWasmAsset from "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"
import type { Env } from "./env"
import hostBridgeScript from "./ruby/app/hibana/host_bridge.rb"
import templateRendererScript from "./ruby/app/hibana/template_renderer.rb"
import contextScript from "./ruby/app/hibana/context.rb"
import htmlRewriterScript from "./ruby/app/hibana/html_rewriter.rb"
import cronScript from "./ruby/app/hibana/cron.rb"
import kvClientScript from "./ruby/app/hibana/kv_client.rb"
import d1ClientScript from "./ruby/app/hibana/d1_client.rb"
import r2ClientScript from "./ruby/app/hibana/r2_client.rb"
import httpClientScript from "./ruby/app/hibana/http_client.rb"
import workersAiClientScript from "./ruby/app/hibana/workers_ai_client.rb"
import staticServerScript from "./ruby/app/hibana/static_server.rb"
import routingScript from "./ruby/app/hibana/routing.rb"
import {
  executeHttpFetch,
  parseHttpRequestPayload,
  type HttpFetchResponsePayload,
} from "./http-fetch-utils"
import { getHelperScripts } from "./helper-registry"
import { getApplicationScripts } from "./script-registry"
import { getTemplateAssets } from "./template-registry"
import { getStaticAssets } from "./static-registry"

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

type HtmlRewriterInputPayload =
  | {
      type: "response"
      body: string
      status?: number
      headers?: Record<string, string>
    }
  | {
      type: "string"
      body: string
    }

interface HtmlRewriterHandlerDefinitionPayload {
  type?: string
  selector?: string
  handler_id?: string
  methods?: unknown
  [key: string]: unknown
}

interface NormalizedHtmlRewriterHandlerDefinition {
  type: "selector" | "document"
  selector?: string
  handlerId: string
  methods: Set<string>
}

type HtmlRewriterEventType =
  | "element"
  | "text"
  | "comments"
  | "doctype"
  | "end"
  | "document"

interface HtmlRewriterCommand {
  op?: unknown
  [key: string]: unknown
}

interface HtmlRewriterCommandResult {
  commands?: unknown
  error?: { class?: unknown; message?: unknown }
}

type HtmlRewriterInvoke = (
  handlerId: string,
  eventType: HtmlRewriterEventType,
  payload: unknown,
) => HtmlRewriterCommand[]

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
      await evalRubyFile(vm, htmlRewriterScript, "app/hibana/html_rewriter.rb") // 5. HTMLRewriter DSL
      await evalRubyFile(vm, cronScript, "app/hibana/cron.rb") // 6. Cron DSL
      await evalRubyFile(vm, kvClientScript, "app/hibana/kv_client.rb") // 7. KVクライアント
      await evalRubyFile(vm, d1ClientScript, "app/hibana/d1_client.rb") // 8. D1クライアント
      await evalRubyFile(vm, r2ClientScript, "app/hibana/r2_client.rb") // 9. R2クライアント
      await evalRubyFile(vm, httpClientScript, "app/hibana/http_client.rb") // 10. HTTPクライアント
      await evalRubyFile(vm, workersAiClientScript, "app/hibana/workers_ai_client.rb") // 11. Workers AIクライアント
      await evalRubyFile(vm, staticServerScript, "app/hibana/static_server.rb") // 12. 静的サーバー
      await registerTemplates(vm) // 13. テンプレート資材をロード
      await registerStaticAssets(vm) // 14. 静的アセットをロード

      // 15. app/helpers 以下のファイルを順次読み込み
      for (const helper of getHelperScripts()) {
        await evalRubyFile(vm, helper.source, helper.filename) // app/helpers配下
      }

      await evalRubyFile(vm, routingScript, "app/hibana/routing.rb") // 16. ルーティングDSL

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
  const queryJson = JSON.stringify(buildQueryObject(url.searchParams))
  const queryArg = vm.eval(toRubyStringLiteral(queryJson))
  context.call("set_query_from_json", queryArg)
  await populateBodyOnContext(context, request, vm)
  const dispatcher = vm.eval("method(:dispatch)")
  const methodArg = vm.eval(toRubyStringLiteral(request.method))
  const pathArg = vm.eval(toRubyStringLiteral(pathname))
  const result = await dispatcher.callAsync("call", methodArg, pathArg, context)
  const serialized = result.toString()

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
      try {
        const payload = JSON.parse(payloadJson) as {
          input?: unknown
          handlers?: unknown
        }
        if (typeof HTMLRewriter !== "function") {
          throw new Error("HTMLRewriter is not available in this environment")
        }
        const rewriter = new HTMLRewriter()
        const invokeHandler = createHtmlRewriterInvoker(vm)
        const handlerPayloads = Array.isArray(payload?.handlers)
          ? (payload.handlers as HtmlRewriterHandlerDefinitionPayload[])
          : []
        for (const handlerPayload of handlerPayloads) {
          const normalized = normalizeHtmlRewriterHandlerDefinition(handlerPayload)
          if (!normalized) {
            continue
          }
          const handlers = buildHtmlRewriterHandlers(normalized, invokeHandler)
          if (!handlers) {
            continue
          }
          if (normalized.type === "selector") {
            if (!normalized.selector) {
              continue
            }
            rewriter.on(normalized.selector, handlers)
          } else {
            rewriter.onDocument(handlers)
          }
        }

        const input = normalizeHtmlRewriterInput(payload?.input)
        const responseInput = buildResponseFromHtmlRewriterInput(input)
        const transformedResponse = rewriter.transform(responseInput)
        const body = await transformedResponse.text()
        const headers: Record<string, string> = {}
        transformedResponse.headers.forEach((value, key) => {
          headers[key] = value
        })
        return JSON.stringify({
          ok: true,
          response: {
            body,
            status: transformedResponse.status,
            headers,
          },
        })
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError))
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
  HostBridge.call(
    "ts_html_rewriter_transform=",
    vm.wrap(host.tsHtmlRewriterTransform),
  )
  HostBridge.call("ts_report_ruby_error=", vm.wrap(host.tsReportRubyError))
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

function createHtmlRewriterInvoker(vm: RubyVM): HtmlRewriterInvoke {
  return (handlerId, eventType, payload) => {
    const payloadJson = JSON.stringify(payload ?? {})
    const script = `Hibana::HTMLRewriter.__dispatch_handler(${toRubyStringLiteral(
      handlerId,
    )}, ${toRubyStringLiteral(eventType)}, ${toRubyStringLiteral(payloadJson)})`
    const result = vm.eval(script)
    const resultJson =
      result && typeof (result as { toString?: () => string }).toString === "function"
        ? (result as { toString: () => string }).toString()
        : String(result)
    let parsed: HtmlRewriterCommandResult
    try {
      parsed = JSON.parse(resultJson) as HtmlRewriterCommandResult
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse HTMLRewriter handler result: ${reason}`)
    }
    if (parsed?.error && typeof parsed.error === "object") {
      const messageCandidate = (parsed.error as { message?: unknown }).message
      const message =
        typeof messageCandidate === "string" && messageCandidate.length > 0
          ? messageCandidate
          : "Ruby HTMLRewriter handler failed"
      throw new Error(message)
    }
    const commands = parsed?.commands
    if (!Array.isArray(commands)) {
      return []
    }
    return commands as HtmlRewriterCommand[]
  }
}

function normalizeHtmlRewriterHandlerDefinition(
  payload: HtmlRewriterHandlerDefinitionPayload | undefined,
): NormalizedHtmlRewriterHandlerDefinition | null {
  if (!payload || typeof payload !== "object") {
    return null
  }
  const handlerIdValue = payload.handler_id
  const handlerId =
    typeof handlerIdValue === "string" && handlerIdValue.length > 0
      ? handlerIdValue
      : null
  if (!handlerId) {
    return null
  }
  const type: "selector" | "document" =
    payload.type === "document" ? "document" : "selector"
  let selector: string | undefined
  if (type === "selector") {
    const selectorValue = payload.selector
    if (typeof selectorValue !== "string" || selectorValue.length === 0) {
      return null
    }
    selector = selectorValue
  }
  const methods = new Set<string>()
  const methodValues = Array.isArray(payload.methods)
    ? (payload.methods as unknown[])
    : []
  for (const method of methodValues) {
    if (typeof method === "string" && method.length > 0) {
      methods.add(method)
    }
  }
  if (methods.size === 0) {
    methods.add(type === "selector" ? "element" : "document")
  }
  return { type, selector, handlerId, methods }
}

function buildHtmlRewriterHandlers(
  definition: NormalizedHtmlRewriterHandlerDefinition,
  invoke: HtmlRewriterInvoke,
): (HTMLRewriterElementHandlers & HTMLRewriterDocumentHandlers) | null {
  const handlers: Partial<HTMLRewriterElementHandlers & HTMLRewriterDocumentHandlers> = {}
  const { handlerId, methods } = definition
  let hasHandler = false

  if (methods.has("element")) {
    hasHandler = true
    handlers.element = (element) => {
      const payload = buildElementPayload(element)
      const commands = invoke(handlerId, "element", payload)
      applyElementCommands(element, commands)
    }
  }

  if (methods.has("text")) {
    hasHandler = true
    handlers.text = (text) => {
      const payload = buildTextPayload(text)
      const commands = invoke(handlerId, "text", payload)
      applyTextCommands(text, commands)
    }
  }

  if (methods.has("comments")) {
    hasHandler = true
    handlers.comments = (comment) => {
      const payload = buildCommentPayload(comment)
      const commands = invoke(handlerId, "comments", payload)
      applyCommentCommands(comment, commands)
    }
  }

  if (methods.has("doctype")) {
    hasHandler = true
    handlers.doctype = (doctype) => {
      const payload = buildDoctypePayload(doctype)
      const commands = invoke(handlerId, "doctype", payload)
      applyDoctypeCommands(doctype, commands)
    }
  }

  if (methods.has("end")) {
    hasHandler = true
    handlers.end = (end) => {
      const payload = buildEndTagPayload(end)
      const commands = invoke(handlerId, "end", payload)
      applyEndTagCommands(end, commands)
    }
  }

  if (methods.has("document")) {
    hasHandler = true
    handlers.document = (document) => {
      const commands = invoke(handlerId, "document", {})
      applyDocumentCommands(document, commands)
    }
  }

  if (!hasHandler) {
    return null
  }

  return handlers as HTMLRewriterElementHandlers & HTMLRewriterDocumentHandlers
}

function normalizeHtmlRewriterInput(raw: unknown): HtmlRewriterInputPayload {
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { type?: unknown }).type === "response"
  ) {
    const record = raw as { body?: unknown; status?: unknown; headers?: unknown }
    return {
      type: "response",
      body: toStringSafe(record.body),
      status: toNumberOrUndefined(record.status),
      headers: ensureHeaderRecord(record.headers),
    }
  }
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { type?: unknown }).type === "string"
  ) {
    const record = raw as { body?: unknown }
    return { type: "string", body: toStringSafe(record.body) }
  }
  if (raw && typeof raw === "object" && "body" in (raw as Record<string, unknown>)) {
    const record = raw as Record<string, unknown>
    return { type: "string", body: toStringSafe(record.body) }
  }
  return { type: "string", body: toStringSafe(raw) }
}

function buildResponseFromHtmlRewriterInput(input: HtmlRewriterInputPayload): Response {
  if (input.type === "response") {
    const headers = new Headers()
    const headerRecord = ensureHeaderRecord(input.headers)
    for (const [key, value] of Object.entries(headerRecord)) {
      headers.set(key, value)
    }
    const status = typeof input.status === "number" ? input.status : 200
    return new Response(input.body ?? "", { status, headers })
  }
  return new Response(input.body ?? "")
}

function buildElementPayload(element: HTMLRewriterElement): Record<string, unknown> {
  const attributes = Array.isArray(element.attributes)
    ? element.attributes.map((attribute) => ({
        name: toStringSafe(attribute?.name),
        value:
          attribute && Object.prototype.hasOwnProperty.call(attribute, "value")
            ? toStringSafe((attribute as { value?: unknown }).value)
            : "",
      }))
    : []
  const namespace =
    typeof (element as { namespaceURI?: unknown }).namespaceURI === "string"
      ? ((element as { namespaceURI: string }).namespaceURI as string)
      : null
  return {
    tagName: element.tagName,
    tag_name: element.tagName,
    namespace,
    namespaceURI: namespace,
    attributes,
  }
}

function buildTextPayload(text: HTMLRewriterText): Record<string, unknown> {
  return {
    text: text.text,
    lastInTextNode: text.lastInTextNode,
    last_in_text_node: text.lastInTextNode,
  }
}

function buildCommentPayload(comment: HTMLRewriterComment): Record<string, unknown> {
  return {
    text: comment.text,
  }
}

function buildDoctypePayload(doctype: HTMLRewriterDoctype): Record<string, unknown> {
  return {
    name: doctype.name,
    publicId: doctype.publicId,
    public_id: doctype.publicId,
    systemId: doctype.systemId,
    system_id: doctype.systemId,
  }
}

function buildEndTagPayload(end: HTMLRewriterEndTag): Record<string, unknown> {
  return {
    name: end.name,
  }
}

function applyElementCommands(
  element: HTMLRewriterElement,
  commands: HtmlRewriterCommand[],
): void {
  if (!Array.isArray(commands)) {
    return
  }
  for (const command of commands) {
    if (!command || typeof command !== "object") {
      continue
    }
    const op = typeof command.op === "string" ? command.op : ""
    switch (op) {
      case "set_attribute": {
        element.setAttribute(toStringSafe(command.name), toStringSafe(command.value))
        break
      }
      case "remove_attribute": {
        element.removeAttribute(toStringSafe(command.name))
        break
      }
      case "set_inner_content": {
        element.setInnerContent(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "set_outer_content": {
        element.setOuterContent(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "append": {
        element.append(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "prepend": {
        element.prepend(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "before": {
        element.before(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "after": {
        element.after(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "replace": {
        element.replace(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "remove": {
        element.remove()
        break
      }
      case "remove_and_keep_content": {
        if (typeof element.removeAndKeepContent === "function") {
          element.removeAndKeepContent()
        }
        break
      }
      case "add_class": {
        if (typeof element.addClass === "function") {
          element.addClass(toStringSafe(command.name))
        }
        break
      }
      case "remove_class": {
        if (typeof element.removeClass === "function") {
          element.removeClass(toStringSafe(command.name))
        }
        break
      }
      case "toggle_class": {
        if (typeof element.toggleClass === "function") {
          const force = toOptionalBoolean(command.force)
          if (force === undefined) {
            element.toggleClass(toStringSafe(command.name))
          } else {
            element.toggleClass(toStringSafe(command.name), force)
          }
        }
        break
      }
    }
  }
}

function applyTextCommands(
  text: HTMLRewriterText,
  commands: HtmlRewriterCommand[],
): void {
  if (!Array.isArray(commands)) {
    return
  }
  for (const command of commands) {
    if (!command || typeof command !== "object") {
      continue
    }
    const op = typeof command.op === "string" ? command.op : ""
    switch (op) {
      case "replace": {
        text.replace(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "before": {
        text.before(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "after": {
        text.after(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "remove": {
        text.remove()
        break
      }
    }
  }
}

function applyCommentCommands(
  comment: HTMLRewriterComment,
  commands: HtmlRewriterCommand[],
): void {
  if (!Array.isArray(commands)) {
    return
  }
  for (const command of commands) {
    if (!command || typeof command !== "object") {
      continue
    }
    const op = typeof command.op === "string" ? command.op : ""
    switch (op) {
      case "replace": {
        comment.replace(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "before": {
        comment.before(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "after": {
        comment.after(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "remove": {
        comment.remove()
        break
      }
    }
  }
}

function applyDoctypeCommands(
  doctype: HTMLRewriterDoctype,
  commands: HtmlRewriterCommand[],
): void {
  if (!Array.isArray(commands)) {
    return
  }
  for (const command of commands) {
    if (!command || typeof command !== "object") {
      continue
    }
    const op = typeof command.op === "string" ? command.op : ""
    switch (op) {
      case "replace": {
        doctype.replace(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "before": {
        doctype.before(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "after": {
        doctype.after(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "remove": {
        doctype.remove()
        break
      }
    }
  }
}

function applyDocumentCommands(
  document: HTMLRewriterDocument,
  commands: HtmlRewriterCommand[],
): void {
  if (!Array.isArray(commands)) {
    return
  }
  for (const command of commands) {
    if (!command || typeof command !== "object") {
      continue
    }
    const op = typeof command.op === "string" ? command.op : ""
    switch (op) {
      case "append": {
        document.append(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "prepend": {
        document.prepend(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "append_to_head": {
        document.appendToHead(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "append_to_body": {
        document.appendToBody(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "prepend_to_head": {
        document.prependToHead(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "prepend_to_body": {
        document.prependToBody(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "replace": {
        document.replace(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "before": {
        document.before(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "after": {
        document.after(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "end": {
        document.end()
        break
      }
    }
  }
}

function applyEndTagCommands(
  end: HTMLRewriterEndTag,
  commands: HtmlRewriterCommand[],
): void {
  if (!Array.isArray(commands)) {
    return
  }
  for (const command of commands) {
    if (!command || typeof command !== "object") {
      continue
    }
    const op = typeof command.op === "string" ? command.op : ""
    switch (op) {
      case "replace": {
        end.replace(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "before": {
        end.before(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "after": {
        end.after(toStringSafe(command.content), htmlContentOptions(command))
        break
      }
      case "remove": {
        end.remove()
        break
      }
    }
  }
}

function htmlContentOptions(
  command: HtmlRewriterCommand,
): HTMLRewriterContentOptions | undefined {
  const htmlValue = command.html
  if (htmlValue === true || htmlValue === "true") {
    return { html: true }
  }
  return undefined
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === "boolean") {
    return value
  }
  if (value === "true") {
    return true
  }
  if (value === "false") {
    return false
  }
  return Boolean(value)
}

function toStringSafe(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (value === undefined || value === null) {
    return ""
  }
  return String(value)
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function ensureHeaderRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {}
  }
  const headers: Record<string, string> = {}
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (headerValue === undefined || headerValue === null) {
      continue
    }
    headers[key] = toStringSafe(headerValue)
  }
  return headers
}

function toRubyStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
  return `"${escaped}"`
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
  context: unknown,
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

function contextCall(context: unknown, method: string, arg: unknown): void {
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
