import type { QueueHandleManager } from "../queue-handle-manager"
import { normalizeDelaySeconds, maybeAwait } from "../queue-handle-manager"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

export function registerQueueHostFunctions(
  host: HostGlobals,
  queueManager: QueueHandleManager,
): void {
  assignHostFnOnce(host, "tsQueueMessageOp", () => {
    return async (payloadJson: string): Promise<string> => {
      return handleQueueMessageHostOp(payloadJson, queueManager)
    }
  })

  assignHostFnOnce(host, "tsQueueBatchOp", () => {
    return async (payloadJson: string): Promise<string> => {
      return handleQueueBatchHostOp(payloadJson, queueManager)
    }
  })
}

async function handleQueueMessageHostOp(
  payloadJson: string,
  queueManager: QueueHandleManager,
): Promise<string> {
  try {
    const payload = JSON.parse(payloadJson) as {
      handle?: string
      op?: string
      delaySeconds?: unknown
    }
    const handle = payload.handle
    if (!handle) {
      throw new Error("Queue message handle is required")
    }
    const record = queueManager.getMessage(handle)
    if (!record) {
      throw new Error(`Queue message handle '${handle}' is not active`)
    }
    if (payload.op !== "ack" && payload.op !== "retry") {
      throw new Error(`Unsupported queue message op '${payload.op}'`)
    }
    try {
      switch (payload.op) {
        case "ack":
          await maybeAwait(record.message.ack())
          break
        case "retry":
          await maybeAwait(
            record.message.retry({
              delaySeconds: normalizeDelaySeconds(payload.delaySeconds),
            }),
          )
          break
      }
    } finally {
      queueManager.deleteMessage(handle)
    }
    return JSON.stringify({ ok: true })
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function handleQueueBatchHostOp(
  payloadJson: string,
  queueManager: QueueHandleManager,
): Promise<string> {
  try {
    const payload = JSON.parse(payloadJson) as {
      handle?: string
      op?: string
      delaySeconds?: unknown
    }
    const handle = payload.handle
    if (!handle) {
      throw new Error("Queue batch handle is required")
    }
    const record = queueManager.getBatch(handle)
    if (!record) {
      throw new Error(`Queue batch handle '${handle}' is not active`)
    }
    switch (payload.op) {
      case "ack_all":
        await maybeAwait(record.batch.ackAll())
        queueManager.markBatchMessagesHandled(handle)
        break
      case "retry_all":
        await maybeAwait(
          record.batch.retryAll({
            delaySeconds: normalizeDelaySeconds(payload.delaySeconds),
          }),
        )
        queueManager.markBatchMessagesHandled(handle)
        break
      default:
        throw new Error(`Unsupported queue batch op '${payload.op}'`)
    }
    return JSON.stringify({ ok: true })
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
