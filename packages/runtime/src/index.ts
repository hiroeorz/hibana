import "./polyfills"
import {
  handleRequest,
  handleScheduled,
  handleQueue,
  handleDurableObjectFetch,
  handleDurableObjectAlarm,
  createDurableObjectClass,
} from "./ruby-runtime"
import type { RuntimeScheduledEvent } from "./ruby-runtime"
import type { Env } from "./env"

export type { Env }
export {
  setHelperScripts,
  addHelperScripts,
  clearHelperScripts,
  getHelperScripts,
  type HelperScript,
} from "./helper-registry"
export {
  setApplicationScripts,
  addApplicationScript,
  clearApplicationScripts,
  getApplicationScripts,
  type RubyScript,
} from "./script-registry"
export {
  setTemplateAssets,
  addTemplateAsset,
  addTemplateAssets,
  clearTemplateAssets,
  getTemplateAssets,
  type TemplateAsset,
} from "./template-registry"
export {
  setStaticAssets,
  addStaticAsset,
  clearStaticAssets,
  getStaticAssets,
  type StaticAsset,
} from "./static-registry"
export {
  handleRequest,
  handleScheduled,
  handleQueue,
  handleDurableObjectFetch,
  handleDurableObjectAlarm,
  createDurableObjectClass,
}
export type { RuntimeScheduledEvent }

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

export async function runtimeFetch(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const { body, status, headers } = await handleRequest(env, request)
    return new Response(body, {
      status,
      headers,
    })
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "予期しないエラーが発生しました"
    return new Response(`Ruby実行エラー: ${reason}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=UTF-8" },
    })
  }
}

export async function runtimeScheduled(
  event: RuntimeScheduledEvent,
  env: Env,
  ctx?: ExecutionContextLike,
): Promise<void> {
  const cronPromise = handleScheduled(env, event)
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(cronPromise)
  }
  await cronPromise
}

export async function runtimeQueue(
  batch: QueueMessageBatch,
  env: Env,
  ctx?: ExecutionContextLike,
): Promise<void> {
  const queuePromise = handleQueue(env, batch)
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(queuePromise)
  }
  await queuePromise
}

const runtime = {
  fetch: runtimeFetch,
  scheduled: runtimeScheduled,
  queue: runtimeQueue,
}

export default runtime

type QueueMessage = {
  id: string
  timestamp: Date | number
  body: unknown
  attempts: number
  ack(): void | Promise<void>
  retry(options?: { delaySeconds?: number }): void | Promise<void>
}

type QueueMessageBatch = {
  queue: string
  messages: readonly QueueMessage[]
  ackAll(): void | Promise<void>
  retryAll(options?: { delaySeconds?: number }): void | Promise<void>
}
