import type {
  QueueMessage,
  QueueMessageBatch,
  QueueMessageHandleRecord,
  QueueBatchHandleRecord,
  SerializedQueueBatch,
  SerializedQueueBody,
} from "./runtime-types"

export class QueueHandleManager {
  private messageHandles = new Map<string, QueueMessageHandleRecord>()
  private batchHandles = new Map<string, QueueBatchHandleRecord>()
  private handleCounter = 0

  registerBatch(
    batch: QueueMessageBatch<unknown>,
    bindingName?: string | null,
  ): { batchHandle: string; payload: SerializedQueueBatch } {
    const batchHandle = this.nextHandle("queue-batch")
    const binding =
      bindingName && bindingName.toString().length > 0
        ? bindingName.toString()
        : null
    const messageHandles: string[] = []
    const messages = (batch.messages || []).map((message, index) => {
      const handle = `${batchHandle}:${index}`
      messageHandles.push(handle)
      this.messageHandles.set(handle, {
        batchHandle,
        message,
      })
      return {
        handle,
        id: message.id?.toString() ?? "",
        attempts: typeof message.attempts === "number" ? message.attempts : 0,
        timestamp: this.toUnixMilliseconds(message.timestamp),
        body: this.serializeBody(message.body),
      }
    })
    this.batchHandles.set(batchHandle, {
      batch,
      messageHandles,
    })
    return {
      batchHandle,
      payload: {
        binding,
        queue: batch.queue ?? "",
        batchHandle,
        messages,
      },
    }
  }

  cleanupBatch(batchHandle: string): void {
    const record = this.batchHandles.get(batchHandle)
    if (record) {
      for (const handle of record.messageHandles) {
        this.messageHandles.delete(handle)
      }
      this.batchHandles.delete(batchHandle)
    }
  }

  getMessage(handle: string): QueueMessageHandleRecord | undefined {
    return this.messageHandles.get(handle)
  }

  deleteMessage(handle: string): void {
    this.messageHandles.delete(handle)
  }

  getBatch(handle: string): QueueBatchHandleRecord | undefined {
    return this.batchHandles.get(handle)
  }

  markBatchMessagesHandled(batchHandle: string): void {
    const record = this.batchHandles.get(batchHandle)
    if (!record) {
      return
    }
    for (const handle of record.messageHandles) {
      this.messageHandles.delete(handle)
    }
    record.messageHandles = []
  }

  private nextHandle(prefix: string): string {
    this.handleCounter += 1
    return `${prefix}-${this.handleCounter}-${Math.random().toString(36).slice(2)}`
  }

  private toUnixMilliseconds(value: Date | number | undefined): number {
    if (value instanceof Date) {
      return value.getTime()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
    return Date.now()
  }

  private serializeBody(body: unknown): SerializedQueueBody {
    if (typeof body === "string") {
      return { format: "text", text: body }
    }
    try {
      const json = JSON.stringify(body ?? null)
      return { format: "json", json: json ?? "null" }
    } catch {
      return { format: "text", text: String(body ?? "") }
    }
  }
}

export function normalizeDelaySeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("delaySeconds must be a non-negative number")
  }
  return Math.floor(parsed)
}

export async function maybeAwait(result: void | Promise<void>): Promise<void> {
  if (result && typeof (result as Promise<void>).then === "function") {
    await result
  }
}
