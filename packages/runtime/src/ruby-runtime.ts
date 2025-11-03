import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser"
import type { RubyVM } from "@ruby/wasm-wasi"
import rubyWasmAsset from "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"
import type { Env } from "./env"
import hostBridgeScript from "./ruby/app/hibana/host_bridge.rb"
import contextScript from "./ruby/app/hibana/context.rb"
import kvClientScript from "./ruby/app/hibana/kv_client.rb"
import d1ClientScript from "./ruby/app/hibana/d1_client.rb"
import r2ClientScript from "./ruby/app/hibana/r2_client.rb"
import httpClientScript from "./ruby/app/hibana/http_client.rb"
import workersAiClientScript from "./ruby/app/hibana/workers_ai_client.rb"
import routingScript from "./ruby/app/hibana/routing.rb"
import {
  executeHttpFetch,
  parseHttpRequestPayload,
  type HttpFetchResponsePayload,
} from "./http-fetch-utils"
import { getHelperScripts } from "./helper-registry"
import { getApplicationScripts } from "./script-registry"

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
}

interface WorkerResponsePayload {
  body: string
  status: number
  headers: Record<string, string>
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
      await evalRubyFile(vm, contextScript, "app/hibana/context.rb") // 3. コンテキスト
      await evalRubyFile(vm, kvClientScript, "app/hibana/kv_client.rb") // 4. KVクライアント
      await evalRubyFile(vm, d1ClientScript, "app/hibana/d1_client.rb") // 5. D1クライアント
      await evalRubyFile(vm, r2ClientScript, "app/hibana/r2_client.rb") // 6. R2クライアント
      await evalRubyFile(vm, httpClientScript, "app/hibana/http_client.rb") // 7. HTTPクライアント
      await evalRubyFile(vm, workersAiClientScript, "app/hibana/workers_ai_client.rb") // 8. Workers AIクライアント

      // 9. app/helpers 以下のファイルを順次読み込み
      for (const helper of getHelperScripts()) {
        await evalRubyFile(vm, helper.source, helper.filename) // 5. app/helpers配下
      }

      await evalRubyFile(vm, routingScript, "app/hibana/routing.rb") // 10. ルーティングDSL

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
