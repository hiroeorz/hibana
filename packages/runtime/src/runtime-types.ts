import type { Env } from "./env"

export interface WorkerResponsePayload {
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

export type D1PreparedStatement = {
  bind: (...args: unknown[]) => D1PreparedStatement
  first: () => Promise<unknown>
  all: () => Promise<{ results: unknown } | unknown>
  run: () => Promise<unknown>
}

export type WorkersAiPayload = {
  binding: string
  method?: string
  args?: unknown[]
  model?: string
  payload?: unknown
  [key: string]: unknown
}

export type VectorizeInvokePayload = {
  binding?: string
  action?: string
  params?: Record<string, unknown>
}

export type QueueRetryOptions = {
  delaySeconds?: number
}

export type QueueMessage<Body = unknown> = {
  readonly id: string
  readonly timestamp: Date | number
  readonly body: Body
  readonly attempts: number
  ack(): void | Promise<void>
  retry(options?: QueueRetryOptions): void | Promise<void>
}

export type QueueMessageBatch<Body = unknown> = {
  readonly queue: string
  readonly messages: readonly QueueMessage<Body>[]
  ackAll(): void | Promise<void>
  retryAll(options?: QueueRetryOptions): void | Promise<void>
}

export type SerializedQueueBody =
  | { format: "text"; text: string }
  | { format: "json"; json: string }

export type SerializedQueueMessage = {
  handle: string
  id: string
  attempts: number
  timestamp: number
  body: SerializedQueueBody
}

export type SerializedQueueBatch = {
  binding: string | null
  queue: string
  batchHandle: string
  messages: SerializedQueueMessage[]
}

export type HostErrorPayload = {
  message: string
  name: string
  stack?: string
}

export type QueueMessageHandleRecord = {
  batchHandle: string
  message: QueueMessage<unknown>
}

export type QueueBatchHandleRecord = {
  batch: QueueMessageBatch<unknown>
  messageHandles: string[]
}

export const METHODS_WITH_BODY = ["POST", "PUT", "PATCH", "DELETE"] as const

export const HOST_ERROR_GENERIC_MESSAGE = "An internal error occurred"

// For security, default to safe side (hide error details).
// Only show details when explicitly in development/dev mode.
export function shouldMaskHostError(env: Env): boolean {
  const normalized = resolveEnvironmentName(env)
  return normalized !== "development" && normalized !== "dev"
}

export function resolveEnvironmentName(env: Env): string | undefined {
  if (!env || typeof env !== "object") {
    return undefined
  }
  const record = env as Record<string, unknown>
  for (const key of ["ENVIRONMENT", "NODE_ENV"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().toLowerCase()
    }
  }
  return undefined
}

export function buildHostErrorPayload(rawError: unknown, env: Env): HostErrorPayload {
  const error = rawError instanceof Error ? rawError : new Error(String(rawError))
  const redactDetails = shouldMaskHostError(env)
  const payload: HostErrorPayload = {
    message: redactDetails ? HOST_ERROR_GENERIC_MESSAGE : error.message,
    name: error.name || "Error",
  }
  if (!redactDetails && error.stack) {
    payload.stack = error.stack
  }
  return payload
}

export function createErrorResponse(rawError: unknown): string {
  const error = rawError instanceof Error ? rawError : new Error(String(rawError))
  return JSON.stringify({
    ok: false,
    error: { message: error.message, name: error.name },
  })
}

export function ensureRecord(
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
