type DurableObjectIdLike = {
  toString(): string
  name?: string
}

type DurableObjectStorageLike = {
  get: (key: string, options?: Record<string, unknown>) => Promise<unknown>
  put: (key: string, value: unknown, options?: Record<string, unknown>) => Promise<unknown>
  delete: (key: string, options?: Record<string, unknown>) => Promise<unknown>
  list: (
    options?: Record<string, unknown>,
  ) => Promise<Map<string, unknown> | [string, unknown][] | Record<string, unknown>>
  getAlarm?: (options?: Record<string, unknown>) => Promise<number | null>
  setAlarm?: (
    scheduledTime: number,
    options?: Record<string, unknown>,
  ) => Promise<void>
  deleteAlarm?: (options?: Record<string, unknown>) => Promise<void>
}

export type DurableObjectStateLike = {
  id: DurableObjectIdLike
  storage: DurableObjectStorageLike
  blockConcurrencyWhile?: <T>(callback: () => Promise<T>) => Promise<T>
  waitUntil?: (promise: Promise<unknown>) => void
  newUniqueId?: (options?: Record<string, unknown>) => DurableObjectIdLike
}

export type DurableObjectMetadata = {
  object_id?: string
  object_name?: string | null
  namespace?: string
}

export type DurableObjectStorageOpPayload = {
  op: "get" | "put" | "delete" | "list"
  key?: string
  value?: unknown
  type?: string
  options?: Record<string, unknown>
}

export type DurableObjectAlarmOpPayload = {
  op: "get" | "set" | "delete"
  scheduled_time?: number
  options?: Record<string, unknown>
}

export type DurableObjectHostResult = {
  ok: boolean
  result?: unknown
  error?: { name: string; message: string }
}

type DurableObjectStateRecord = {
  bindingName: string
  state: DurableObjectStateLike
  metadata: DurableObjectMetadata
}

const durableStateStore = new Map<string, DurableObjectStateRecord>()

export function registerDurableObjectState(
  bindingName: string,
  state: DurableObjectStateLike,
): { handle: string; metadata: DurableObjectMetadata } {
  const handle = generateStateHandle()
  const metadata = buildMetadata(bindingName, state)
  durableStateStore.set(handle, { bindingName, state, metadata })
  return { handle, metadata }
}

export function getDurableObjectMetadata(handle: string): DurableObjectMetadata {
  const record = durableStateStore.get(handle)
  if (!record) {
    throw new Error(`Durable Object state '${handle}' is not registered`)
  }
  return record.metadata
}

export function releaseDurableObjectState(handle: string): void {
  durableStateStore.delete(handle)
}

export async function runDurableObjectStorageOp(
  handle: string,
  payload: DurableObjectStorageOpPayload,
): Promise<DurableObjectHostResult> {
  try {
    const record = getStateRecord(handle)
    const storage = record.state.storage
    switch (payload.op) {
      case "get": {
        assertKeyPresent(payload.key, "get")
        const result = await storage.get(payload.key!, payload.options)
        return { ok: true, result }
      }
      case "put": {
        assertKeyPresent(payload.key, "put")
        await storage.put(payload.key!, payload.value, payload.options)
        return { ok: true }
      }
      case "delete": {
        assertKeyPresent(payload.key, "delete")
        const result = await storage.delete(payload.key!, payload.options)
        return { ok: true, result }
      }
      case "list": {
        const result = await storage.list(payload.options)
        return { ok: true, result: normalizeListResult(result) }
      }
      default:
        throw new Error(`Unsupported storage operation '${payload.op}'`)
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function runDurableObjectAlarmOp(
  handle: string,
  payload: DurableObjectAlarmOpPayload,
): Promise<DurableObjectHostResult> {
  try {
    const record = getStateRecord(handle)
    const storage = record.state.storage
    ensureAlarmSupport(storage, payload.op)

    switch (payload.op) {
      case "get": {
        const result = await storage.getAlarm!()
        return { ok: true, result }
      }
      case "set": {
        if (typeof payload.scheduled_time !== "number") {
          throw new Error("Alarm scheduling requires 'scheduled_time'")
        }
        await storage.setAlarm!(payload.scheduled_time, payload.options)
        return { ok: true }
      }
      case "delete": {
        await storage.deleteAlarm!()
        return { ok: true }
      }
      default:
        throw new Error(`Unsupported alarm operation '${payload.op}'`)
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function getStateRecord(handle: string): DurableObjectStateRecord {
  const record = durableStateStore.get(handle)
  if (!record) {
    throw new Error(`Durable Object state '${handle}' is not registered`)
  }
  return record
}

function assertKeyPresent(key: string | undefined, op: string): void {
  if (!key) {
    throw new Error(`Durable Object storage '${op}' requires a key`)
  }
}

function ensureAlarmSupport(storage: DurableObjectStorageLike, op: string): void {
  const missing =
    (op === "get" && typeof storage.getAlarm !== "function") ||
    (op === "set" && typeof storage.setAlarm !== "function") ||
    (op === "delete" && typeof storage.deleteAlarm !== "function")
  if (missing) {
    throw new Error("Durable Object storage alarms are not supported in this environment")
  }
}

function normalizeListResult(
  value: Map<string, unknown> | [string, unknown][] | Record<string, unknown>,
): Array<{ key: string; value: unknown }> | Record<string, unknown> {
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([key, entryValue]) => ({ key, value: entryValue }))
  }
  if (Array.isArray(value)) {
    return value.map(([key, entryValue]) => ({ key, value: entryValue }))
  }
  return value
}

function buildMetadata(bindingName: string, state: DurableObjectStateLike): DurableObjectMetadata {
  const idString = state.id?.toString?.() ?? ""
  const name = typeof state.id?.name === "string" ? state.id.name : null
  return {
    object_id: idString,
    object_name: name,
    namespace: bindingName,
  }
}

function generateStateHandle(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
