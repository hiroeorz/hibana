import type { Env } from "./env"

type DurableObjectNamespaceLike = {
  idFromName: (name: string) => DurableObjectIdLike
  idFromString?: (id: string) => DurableObjectIdLike
  get: (id: DurableObjectIdLike) => DurableObjectStubLike
}

type DurableObjectIdLike = {
  toString(): string
}

type DurableObjectStubLike = {
  fetch: (request: Request) => Promise<Response>
}

export type DurableObjectStubTargetPayload = {
  type: "name" | "id"
  value: string
}

export type DurableObjectStubRequestPayload = {
  method?: string
  path?: string
  headers?: Record<string, string>
  query?: Record<string, string | string[]>
  body?: string
  json?: unknown
}

export type DurableObjectStubFetchPayload = {
  binding: string
  target: DurableObjectStubTargetPayload
  request: DurableObjectStubRequestPayload
}

export type DurableObjectStubFetchResult = {
  ok: boolean
  result?: {
    status: number
    headers: Record<string, string>
    body: string
  }
  error?: { name: string; message: string }
}

export async function runDurableObjectStubFetch(
  env: Env,
  payload: DurableObjectStubFetchPayload,
): Promise<DurableObjectStubFetchResult> {
  try {
    const namespace = getNamespace(env, payload.binding)
    const objectId = resolveObjectId(namespace, payload.target)
    const stub = namespace.get(objectId)
    const request = buildRequest(payload.request)
    const response = await stub.fetch(request)
    const bodyText = await response.text()
    return {
      ok: true,
      result: {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: bodyText,
      },
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

function getNamespace(env: Env, binding: string): DurableObjectNamespaceLike {
  const namespace = (env as Record<string, unknown>)[binding]
  if (!namespace || typeof namespace !== "object") {
    throw new Error(`Durable Object namespace '${binding}' is not available`)
  }
  if (
    typeof (namespace as DurableObjectNamespaceLike).get !== "function" ||
    typeof (namespace as DurableObjectNamespaceLike).idFromName !== "function"
  ) {
    throw new Error(`Binding '${binding}' is not a Durable Object namespace`)
  }
  return namespace as DurableObjectNamespaceLike
}

function resolveObjectId(
  namespace: DurableObjectNamespaceLike,
  target: DurableObjectStubTargetPayload,
): DurableObjectIdLike {
  if (target.type === "name") {
    return namespace.idFromName(target.value)
  }
  if (target.type === "id") {
    if (typeof namespace.idFromString !== "function") {
      throw new Error("Durable Object namespace does not support idFromString")
    }
    return namespace.idFromString(target.value)
  }
  throw new Error(`Unsupported Durable Object target type '${target.type}'`)
}

function buildRequest(request: DurableObjectStubRequestPayload): Request {
  const method = (request.method ?? "GET").toUpperCase()
  const url = buildRequestUrl(request.path ?? "/", request.query)
  const headers = new Headers(request.headers ?? {})
  let body: BodyInit | undefined

  if (request.json !== undefined) {
    body = JSON.stringify(request.json)
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json")
    }
  } else if (typeof request.body === "string") {
    body = request.body
  }

  return new Request(url, {
    method,
    headers,
    body,
  })
}

function buildRequestUrl(
  path: string,
  query: Record<string, string | string[]> | undefined,
): string {
  const base = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `https://durable-object.local${path.startsWith("/") ? path : `/${path}`}`
  const url = new URL(base)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        value.forEach((entry) => url.searchParams.append(key, entry))
      } else if (value !== undefined && value !== null) {
        url.searchParams.append(key, value)
      }
    }
  }
  return url.toString()
}
