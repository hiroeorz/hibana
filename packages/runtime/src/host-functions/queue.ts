import type { QueueHandleManager } from "../queue-handle-manager"
import { normalizeDelaySeconds, maybeAwait } from "../queue-handle-manager"
import { wrapHostOperation } from "../runtime-types"
import type { HostGlobals } from "./types"
import { assignHostFnOnce } from "./types"

type QueueOpPayload = {
  handle?: string
  op?: string
  delaySeconds?: unknown
}

export function registerQueueHostFunctions(
  host: HostGlobals,
  queueManager: QueueHandleManager,
): void {
  assignHostFnOnce(host, "tsQueueMessageOp", () => {
    return async (payloadJson: string): Promise<string> => {
      return wrapHostOperation(async () => {
        const payload = JSON.parse(payloadJson) as QueueOpPayload
        await executeQueueMessageOp(payload, queueManager)
        return undefined as unknown
      })
    }
  })

  assignHostFnOnce(host, "tsQueueBatchOp", () => {
    return async (payloadJson: string): Promise<string> => {
      return wrapHostOperation(async () => {
        const payload = JSON.parse(payloadJson) as QueueOpPayload
        await executeQueueBatchOp(payload, queueManager)
        return undefined as unknown
      })
    }
  })
}

async function executeQueueMessageOp(
  payload: QueueOpPayload,
  queueManager: QueueHandleManager,
): Promise<void> {
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
}

async function executeQueueBatchOp(
  payload: QueueOpPayload,
  queueManager: QueueHandleManager,
): Promise<void> {
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
}
