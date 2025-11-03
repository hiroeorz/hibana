export type HttpFetchRequestPayload = {
  url: string
  method: string
  headers?: Record<string, string | string[] | number | boolean>
  body?: string
  timeoutMs?: number
  responseType?: "text" | "json" | "arrayBuffer"
}

type HttpFetchSuccessPayload = {
  ok: true
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  responseType: "text" | "json" | "arrayBuffer"
  url: string
  base64?: true
}

type HttpFetchErrorPayload = {
  ok: false
  error: {
    message: string
    name?: string
    stack?: string
  }
}

export type HttpFetchResponsePayload = HttpFetchSuccessPayload | HttpFetchErrorPayload

export function parseHttpRequestPayload(payloadJson: string): HttpFetchRequestPayload {
  try {
    const parsed = JSON.parse(payloadJson)
    if (!parsed || typeof parsed !== "object") {
      throw new Error("HTTP request payload is malformed")
    }

    const url = (parsed as { url?: unknown }).url
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("HTTP request payload must include url as string")
    }

    const method = (parsed as { method?: unknown }).method
    const headers = (parsed as { headers?: unknown }).headers
    const body = (parsed as { body?: unknown }).body
    const timeoutMs = (parsed as { timeoutMs?: unknown }).timeoutMs
    const responseType = (parsed as { responseType?: unknown }).responseType

    return {
      url,
      method: typeof method === "string" && method.length > 0 ? method.toUpperCase() : "GET",
      headers:
        headers && typeof headers === "object"
          ? (headers as Record<string, string | string[] | number | boolean>)
          : undefined,
      body: typeof body === "string" ? body : undefined,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
      responseType:
        responseType === "json" || responseType === "arrayBuffer" || responseType === "text"
          ? responseType
          : undefined,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown JSON parse error"
    throw new Error(`Failed to parse HTTP request payload: ${reason}`)
  }
}

export function normalizeHeaders(
  headers: Record<string, string | string[] | number | boolean> | undefined,
): HeadersInit | undefined {
  if (!headers) {
    return undefined
  }

  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item)).join(", ")
    } else {
      normalized[key] = String(value)
    }
  }
  return normalized
}

export function inferResponseType(response: Response): "text" | "json" | "arrayBuffer" {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.includes("application/json")) {
    return "json"
  }
  if (
    contentType.includes("application/octet-stream") ||
    contentType.includes("application/pdf") ||
    contentType.includes("image/") ||
    contentType.includes("audio/") ||
    contentType.includes("video/")
  ) {
    return "arrayBuffer"
  }
  return "text"
}

export async function executeHttpFetch(
  payload: HttpFetchRequestPayload,
): Promise<HttpFetchResponsePayload> {
  const controller =
    typeof payload.timeoutMs === "number" && payload.timeoutMs > 0
      ? new AbortController()
      : undefined

  let timeoutId: number | undefined
  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), payload.timeoutMs) as unknown as number
  }

  try {
    const requestInit: RequestInit = {
      method: payload.method || "GET",
      headers: normalizeHeaders(payload.headers),
    }

    if (controller) {
      requestInit.signal = controller.signal
    }

    if (payload.body !== undefined) {
      requestInit.body = payload.body
    }

    const response = await fetch(payload.url, requestInit)
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }

    const normalizedHeaders: Record<string, string> = {}
    for (const [key, value] of response.headers.entries()) {
      normalizedHeaders[key] = value
    }

    const responseType = payload.responseType ?? inferResponseType(response)
    let body: string
    let base64 = false

    switch (responseType) {
      case "json": {
        body = await response.text()
        break
      }
      case "arrayBuffer": {
        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        for (const byte of bytes) {
          binary += String.fromCharCode(byte)
        }
        body = btoa(binary)
        base64 = true
        break
      }
      case "text":
      default: {
        body = await response.text()
        break
      }
    }

    const result: HttpFetchSuccessPayload = {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: normalizedHeaders,
      body,
      responseType: base64 ? "arrayBuffer" : responseType,
      url: response.url,
      ...(base64 ? { base64: true as const } : {}),
    }

    return result
  } catch (rawError) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    const error = rawError instanceof Error ? rawError : new Error(String(rawError))
    const result: HttpFetchErrorPayload = {
      ok: false,
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
    }
    return result
  }
}
