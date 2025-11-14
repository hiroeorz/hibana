import type { RubyVM } from "@ruby/wasm-wasi"
import { toRubyStringLiteral } from "./ruby-utils"

type RubyMethod = {
  callAsync: (...args: unknown[]) => Promise<unknown>
}

type RubyBridge = {
  handleEvent: RubyMethod
  releaseHandler: RubyMethod
}

type TransformRequest = {
  options?: {
    preserveContentLength?: boolean
  }
  elementHandlers?: RubyHandlerConfig[]
  documentHandlers?: RubyHandlerConfig[]
  response: ResponsePayload
}

type RubyHandlerConfig = {
  selector?: string
  handlerId: string
  methods?: string[]
}

type ResponsePayload = {
  body: string
  status: number
  headers?: Record<string, string>
}

type HandlerResult = {
  operations?: HandlerOperation[]
  error?: {
    message?: string
    class?: string
  }
}

type HandlerOperation = {
  op: string
  [key: string]: unknown
}

type HtmlRewriterInstance = {
  on: (selector: string, handler: Record<string, (value: unknown) => unknown>) => HtmlRewriterInstance
  onDocument: (handler: Record<string, (value: unknown) => unknown>) => HtmlRewriterInstance
  transform: (response: Response) => Response
}

const BRIDGE_CACHE = new WeakMap<RubyVM, RubyBridge>()

export async function transformHtmlWithRubyHandlers(
  vm: RubyVM,
  payloadJson: string,
  options?: {
    redactStack?: boolean
    genericMessage?: string
  },
): Promise<string> {
  try {
    const payload = JSON.parse(payloadJson) as TransformRequest
    const rewriter = createHtmlRewriter(payload.options)
    const bridge = getBridge(vm)
    registerElementHandlers(vm, bridge, rewriter, payload.elementHandlers ?? [])
    registerDocumentHandlers(vm, bridge, rewriter, payload.documentHandlers ?? [])
    const rewritten = rewriter.transform(createResponse(payload.response))
    const body = await rewritten.text()
    const headers = serializeHeaders(rewritten.headers)
    return JSON.stringify({
      ok: true,
      body,
      status: rewritten.status,
      headers,
    })
  } catch (rawError) {
    const error = rawError instanceof Error ? rawError : new Error(String(rawError))
    return JSON.stringify({
      ok: false,
      error: buildBridgeErrorPayload(error, options),
    })
  }
}

function getBridge(vm: RubyVM): RubyBridge {
  let bridge = BRIDGE_CACHE.get(vm)
  if (!bridge) {
    const handleEvent = vm.eval("Hibana::HTMLRewriter::Bridge.method(:handle_event)") as RubyMethod
    const releaseHandler = vm.eval("Hibana::HTMLRewriter::Bridge.method(:release_handler)") as RubyMethod
    bridge = { handleEvent, releaseHandler }
    BRIDGE_CACHE.set(vm, bridge)
  }
  return bridge
}

function createHtmlRewriter(
  options: TransformRequest["options"],
): HtmlRewriterInstance {
  const ctor = (globalThis as typeof globalThis & { HTMLRewriter?: new (opts?: unknown) => HtmlRewriterInstance }).HTMLRewriter
  if (typeof ctor !== "function") {
    throw new Error("HTMLRewriter is not available in this environment")
  }
  if (options && Object.keys(options).length > 0) {
    return new ctor(options)
  }
  return new ctor()
}

function registerElementHandlers(
  vm: RubyVM,
  bridge: RubyBridge,
  rewriter: HtmlRewriterInstance,
  configs: RubyHandlerConfig[],
): void {
  for (const config of configs) {
    if (!config.selector || typeof config.handlerId !== "string") {
      continue
    }
    const handler = buildElementHandler(vm, bridge, config)
    rewriter.on(config.selector, handler)
  }
}

function buildBridgeErrorPayload(
  error: Error,
  options?: {
    redactStack?: boolean
    genericMessage?: string
  },
): { message: string; name: string; stack?: string } {
  const redactStack = options?.redactStack === true
  const payload: { message: string; name: string; stack?: string } = {
    message: redactStack ? options?.genericMessage || "An internal error occurred" : error.message,
    name: error.name,
  }
  if (!redactStack && error.stack) {
    payload.stack = error.stack
  }
  return payload
}

function registerDocumentHandlers(
  vm: RubyVM,
  bridge: RubyBridge,
  rewriter: HtmlRewriterInstance,
  configs: RubyHandlerConfig[],
): void {
  for (const config of configs) {
    if (typeof config.handlerId !== "string") {
      continue
    }
    const handler = buildDocumentHandler(vm, bridge, config)
    rewriter.onDocument(handler)
  }
}

function buildElementHandler(
  vm: RubyVM,
  bridge: RubyBridge,
  config: RubyHandlerConfig,
): Record<string, (value: unknown) => Promise<void>> {
  const handler: Record<string, (value: unknown) => Promise<void>> = {}
  const methods = new Set(config.methods ?? [])

  if (methods.has("element")) {
    handler.element = (element) => handleElementEvent(vm, bridge, config.handlerId, element)
  }

  if (methods.has("text")) {
    handler.text = (text) => handleTextEvent(vm, bridge, config.handlerId, text, "text")
  }

  if (methods.has("comments")) {
    handler.comments = (comment) => handleCommentEvent(vm, bridge, config.handlerId, comment)
  }

  return handler
}

function buildDocumentHandler(
  vm: RubyVM,
  bridge: RubyBridge,
  config: RubyHandlerConfig,
): Record<string, (value: unknown) => Promise<void>> {
  const handler: Record<string, (value: unknown) => Promise<void>> = {}
  const methods = new Set(config.methods ?? [])

  if (methods.has("text")) {
    handler.text = (text) => handleTextEvent(vm, bridge, config.handlerId, text, "text")
  }

  if (methods.has("comments")) {
    handler.comments = (comment) => handleCommentEvent(vm, bridge, config.handlerId, comment)
  }

  if (methods.has("doctype")) {
    handler.doctype = (doctype) => handleDoctypeEvent(vm, bridge, config.handlerId, doctype)
  }

  if (methods.has("end")) {
    handler.end = (endEvent) => handleDocumentEndEvent(vm, bridge, config.handlerId, endEvent)
  }

  return handler
}

async function handleElementEvent(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  element: any,
): Promise<void> {
  const payload = serializeElement(element)
  const result = await invokeRubyHandler(vm, bridge, handlerId, "element", payload)
  applyElementOperations(vm, bridge, element, result.operations ?? [])
}

async function handleTextEvent(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  text: any,
  eventType: "text",
): Promise<void> {
  const payload = serializeText(text)
  const result = await invokeRubyHandler(vm, bridge, handlerId, eventType, payload)
  applyTextOperations(text, result.operations ?? [])
}

async function handleCommentEvent(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  comment: any,
): Promise<void> {
  const payload = serializeComment(comment)
  const result = await invokeRubyHandler(vm, bridge, handlerId, "comments", payload)
  applyCommentOperations(comment, result.operations ?? [])
}

async function handleDoctypeEvent(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  doctype: any,
): Promise<void> {
  const payload = serializeDoctype(doctype)
  await invokeRubyHandler(vm, bridge, handlerId, "doctype", payload)
}

async function handleDocumentEndEvent(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  endEvent: any,
): Promise<void> {
  const result = await invokeRubyHandler(vm, bridge, handlerId, "end", {})
  applyDocumentEndOperations(endEvent, result.operations ?? [])
}

async function handleEndTagEvent(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  endTag: any,
): Promise<void> {
  try {
    const payload = serializeEndTag(endTag)
    const result = await invokeRubyHandler(vm, bridge, handlerId, "end_tag", payload)
    applyEndTagOperations(endTag, result.operations ?? [])
  } finally {
    await releaseHandler(vm, bridge, handlerId)
  }
}

async function invokeRubyHandler(
  vm: RubyVM,
  bridge: RubyBridge,
  handlerId: string,
  eventType: string,
  payload: unknown,
): Promise<HandlerResult> {
  const handlerIdArg = vm.eval(toRubyStringLiteral(handlerId))
  const typeArg = vm.eval(toRubyStringLiteral(eventType))
  const payloadArg = vm.eval(toRubyStringLiteral(JSON.stringify(payload ?? {})))
  const rawResult = await bridge.handleEvent.callAsync("call", handlerIdArg, typeArg, payloadArg)
  const json = rawResult && typeof (rawResult as { toString: () => string }).toString === "function"
    ? (rawResult as { toString: () => string }).toString()
    : ""
  if (!json) {
    return { operations: [] }
  }
  const parsed = JSON.parse(json) as HandlerResult
  if (parsed.error) {
    const message = parsed.error.message || "HTMLRewriter handler failed"
    throw new Error(message)
  }
  return parsed
}

async function releaseHandler(vm: RubyVM, bridge: RubyBridge, handlerId: string): Promise<void> {
  const handlerIdArg = vm.eval(toRubyStringLiteral(handlerId))
  await bridge.releaseHandler.callAsync("call", handlerIdArg)
}

function applyElementOperations(
  vm: RubyVM,
  bridge: RubyBridge,
  element: any,
  operations: HandlerOperation[],
): void {
  for (const operation of operations) {
    switch (operation.op) {
      case "set_attribute": {
        const name = typeof operation.name === "string" ? operation.name : String(operation.name ?? "")
        if (name) {
          element.setAttribute(name, operation.value ?? "")
        }
        break
      }
      case "remove_attribute": {
        const name = typeof operation.name === "string" ? operation.name : String(operation.name ?? "")
        if (name) {
          element.removeAttribute(name)
        }
        break
      }
      case "add_class":
        if (operation.value !== undefined && typeof element.addClass === "function") {
          element.addClass(operation.value)
        }
        break
      case "remove_class":
        if (operation.value !== undefined && typeof element.removeClass === "function") {
          element.removeClass(operation.value)
        }
        break
      case "set_inner_content":
        element.setInnerContent(operation.content ?? "", { html: operation.html === true })
        break
      case "set_outer_content":
        element.setOuterContent(operation.content ?? "", { html: operation.html === true })
        break
      case "append":
        element.append(operation.content ?? "", { html: operation.html === true })
        break
      case "prepend":
        element.prepend(operation.content ?? "", { html: operation.html === true })
        break
      case "before":
        element.before(operation.content ?? "", { html: operation.html === true })
        break
      case "after":
        element.after(operation.content ?? "", { html: operation.html === true })
        break
      case "replace":
        element.replace(operation.content ?? "", { html: operation.html === true })
        break
      case "remove":
        element.remove()
        break
      case "on_end_tag":
        if (typeof operation.handlerId === "string") {
          element.onEndTag((endTag: any) => handleEndTagEvent(vm, bridge, operation.handlerId as string, endTag))
        }
        break
      default:
        break
    }
  }
}

function applyTextOperations(text: any, operations: HandlerOperation[]): void {
  for (const operation of operations) {
    switch (operation.op) {
      case "replace":
        text.replace(operation.content ?? "", { html: operation.html === true })
        break
      case "before":
        text.before(operation.content ?? "", { html: operation.html === true })
        break
      case "after":
        text.after(operation.content ?? "", { html: operation.html === true })
        break
      case "prepend":
        text.prepend(operation.content ?? "", { html: operation.html === true })
        break
      case "append":
        text.append(operation.content ?? "", { html: operation.html === true })
        break
      case "remove":
        text.remove()
        break
      default:
        break
    }
  }
}

function applyCommentOperations(comment: any, operations: HandlerOperation[]): void {
  for (const operation of operations) {
    switch (operation.op) {
      case "replace":
        comment.replace(operation.content ?? "")
        break
      case "before":
        comment.before(operation.content ?? "")
        break
      case "after":
        comment.after(operation.content ?? "")
        break
      case "remove":
        comment.remove()
        break
      default:
        break
    }
  }
}

function applyEndTagOperations(endTag: any, operations: HandlerOperation[]): void {
  for (const operation of operations) {
    switch (operation.op) {
      case "before":
        endTag.before(operation.content ?? "", { html: operation.html === true })
        break
      case "after":
        endTag.after(operation.content ?? "", { html: operation.html === true })
        break
      case "remove":
        endTag.remove()
        break
      default:
        break
    }
  }
}

function applyDocumentEndOperations(endEvent: any, operations: HandlerOperation[]): void {
  for (const operation of operations) {
    const content = operation.content ?? ""
    const options = { html: operation.html === true }
    switch (operation.op) {
      case "append":
        if (typeof endEvent.append === "function") {
          endEvent.append(content, options)
        } else if (typeof endEvent.after === "function") {
          endEvent.after(content, options)
        }
        break
      case "prepend":
        if (typeof endEvent.prepend === "function") {
          endEvent.prepend(content, options)
        } else if (typeof endEvent.before === "function") {
          endEvent.before(content, options)
        }
        break
      case "after":
        if (typeof endEvent.after === "function") {
          endEvent.after(content, options)
        } else if (typeof endEvent.append === "function") {
          endEvent.append(content, options)
        }
        break
      case "before":
        if (typeof endEvent.before === "function") {
          endEvent.before(content, options)
        } else if (typeof endEvent.prepend === "function") {
          endEvent.prepend(content, options)
        }
        break
      default:
        break
    }
  }
}

function serializeElement(element: any): Record<string, unknown> {
  const attributes: Array<[string, string]> = []
  if (typeof element.attributes?.[Symbol.iterator] === "function") {
    for (const [name, value] of element.attributes as Iterable<[string, string]>) {
      attributes.push([name, value])
    }
  }
  return {
    tagName: element.tagName ?? "",
    namespaceURI: element.namespaceURI ?? null,
    attributes,
    removed: Boolean(element.removed),
  }
}

function serializeText(text: any): Record<string, unknown> {
  return {
    text: text.text ?? "",
    lastInTextNode: Boolean(text.lastInTextNode),
  }
}

function serializeComment(comment: any): Record<string, unknown> {
  return {
    text: comment.text ?? "",
  }
}

function serializeDoctype(doctype: any): Record<string, unknown> {
  return {
    name: doctype.name ?? "",
    publicId: doctype.publicId ?? null,
    systemId: doctype.systemId ?? null,
  }
}

function serializeEndTag(endTag: any): Record<string, unknown> {
  return {
    name: endTag.name ?? "",
  }
}

function createResponse(payload: ResponsePayload): Response {
  const headers = new Headers()
  if (payload.headers) {
    for (const [key, value] of Object.entries(payload.headers)) {
      headers.set(key, value)
    }
  }
  const status =
    typeof payload.status === "number"
      ? payload.status
      : Number(payload.status ?? 200)
  return new Response(payload.body ?? "", {
    status,
    headers,
  })
}

function serializeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}
