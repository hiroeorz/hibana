import { DefaultRubyVM } from '@ruby/wasm-wasi/dist/browser';
import type { RubyVM } from '@ruby/wasm-wasi/dist/vm';

import wasmModule from '../dist/wasm/app.wasm';
import manifestModule from '../dist/wasm/manifest.js';

type HeaderMap = Record<string, string>;

type RubySources = Map<string, string>;

interface ManifestEntry {
  path: string;
  size: number;
  digest: string;
}

interface ManifestShape {
  entrypoint: string;
  sources_archive: string;
  sources: ManifestEntry[];
  source_contents?: Record<string, string>;
}

interface RequestPayload {
  method: string;
  path: string;
  query_string: string;
  scheme: string;
  headers: HeaderMap;
  body?: string;
  content_type?: string;
  content_length?: string;
}

interface RuntimeResult {
  status: number;
  headers: HeaderMap;
  body: string;
}

interface RubyRuntime {
  vm: RubyVM;
  handle: (payload: RequestPayload) => Promise<RuntimeResult>;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const runtimePromise = bootstrapRubyRuntime();

export default {
  async fetch(request: Request): Promise<Response> {
    const runtime = await runtimePromise;
    const payload = await buildRequestPayload(request);
    const result = await runtime.handle(payload);
    return new Response(result.body, { status: result.status, headers: result.headers });
  }
};

async function bootstrapRubyRuntime(): Promise<RubyRuntime> {
  const rubyModule = await ensureModule(wasmModule);
  const { vm } = await DefaultRubyVM(rubyModule, {
    env: {
      RUBYOPT: '--disable-gems'
    }
  });

  const manifest = manifestModule as ManifestShape;
  const sources = await loadSources(manifest);
  const rubyFiles = selectRubyFiles(manifest);

  for (const path of rubyFiles) {
    const source = sources.get(path);
    if (!source) {
      throw new Error(`Missing Ruby source "${path}" in WASM bundle`);
    }

    await vm.evalAsync(source);
  }

  await vm.evalAsync(RUNTIME_BRIDGE_SCRIPT);

  return {
    vm,
    async handle(payload: RequestPayload): Promise<RuntimeResult> {
      const payloadJson = JSON.stringify(payload);
      const rubyResponse = await vm.evalAsync(`Hibana::Runtime.handle_json(${JSON.stringify(payloadJson)})`);
      return JSON.parse(rubyResponse.toString()) as RuntimeResult;
    }
  };
}

async function ensureModule(target: unknown): Promise<WebAssembly.Module> {
  if (target instanceof WebAssembly.Module) {
    return target;
  }

  if (isPromise(target)) {
    const resolved = await target;
    return ensureModule(resolved);
  }

  if (target instanceof ArrayBuffer || ArrayBuffer.isView(target)) {
    const buffer = target instanceof ArrayBuffer ? target : target.buffer;
    return WebAssembly.compile(buffer);
  }

  throw new TypeError('Unsupported WASM module format');
}

function isPromise<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof (value as PromiseLike<T>).then === 'function';
}

async function loadSources(manifest: ManifestShape): Promise<RubySources> {
  if (manifest.source_contents && Object.keys(manifest.source_contents).length > 0) {
    const map: RubySources = new Map();
    for (const [path, base64] of Object.entries(manifest.source_contents)) {
      map.set(path, decodeUtf8(decodeBase64(base64)));
    }
    return map;
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('Current runtime cannot unpack Ruby sources. Rebuild with the latest Hibana CLI.');
  }

  const archiveBytes = await fetchSourcesArchive(manifest.sources_archive);
  return decodeArchive(archiveBytes);
}

async function fetchSourcesArchive(filename: string): Promise<Uint8Array> {
  const archiveUrl = new URL(`../dist/wasm/${filename}`, import.meta.url);
  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sources archive: ${response.status} ${response.statusText}`);
  }

  const compressed = await response.arrayBuffer();
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function decodeArchive(bytes: Uint8Array): RubySources {
  const files = new Map<string, string>();
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (isEndOfArchive(header)) {
      break;
    }

    const name = decodeNullTerminated(header.subarray(0, 100));
    if (!name) {
      break;
    }

    const sizeOctal = decodeNullTerminated(header.subarray(124, 136)).trim();
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const start = offset + 512;
    const end = start + size;

    files.set(name, decodeUtf8(bytes.slice(start, end)));

    const remainder = size % 512;
    offset = end + (remainder === 0 ? 0 : 512 - remainder);
  }

  return files;
}

function selectRubyFiles(manifest: ManifestShape): string[] {
  const rubyPaths = manifest.sources
    .map((source) => source.path)
    .filter((path) => path.endsWith('.rb') && !path.startsWith('lib/hibana/wasm/'));

  const unique = new Set<string>(rubyPaths);
  const ordered: string[] = [];

  if (unique.has(manifest.entrypoint)) {
    ordered.push(manifest.entrypoint);
    unique.delete(manifest.entrypoint);
  }

  for (const path of Array.from(unique).sort((a, b) => a.localeCompare(b))) {
    ordered.push(path);
  }

  return ordered;
}

async function buildRequestPayload(request: Request): Promise<RequestPayload> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const headers: HeaderMap = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  if (!('host' in headers)) {
    headers.host = url.host;
  }

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await request.text();
  }

  const payload: RequestPayload = {
    method,
    path: url.pathname,
    query_string: url.search.slice(1),
    scheme: url.protocol.replace(':', ''),
    headers
  };

  if (body !== undefined) {
    payload.body = body;
    payload.content_length = headers['content-length'] ?? String(textEncoder.encode(body).length);
  }

  const contentType = request.headers.get('content-type');
  if (contentType) {
    payload.content_type = contentType;
  }

  return payload;
}

function isEndOfArchive(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) {
      return false;
    }
  }
  return true;
}

function decodeNullTerminated(bytes: Uint8Array): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return textDecoder.decode(bytes.subarray(0, end));
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const maybeBuffer = (globalThis as Record<string, unknown>).Buffer as undefined | {
    from(data: string, encoding: string): Uint8Array;
  };

  if (typeof maybeBuffer === 'function') {
    return new Uint8Array(maybeBuffer.from(base64, 'base64'));
  }

  throw new Error('Base64 decoding is not supported in this environment');
}

function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

const RUNTIME_BRIDGE_SCRIPT = String.raw`
require 'json'
require 'stringio'

module Hibana
  module Runtime
    module_function

    def handle_json(request_json)
      payload = JSON.parse(request_json)
      JSON.generate(handle(payload))
    end

    def handle(payload)
      env = build_env(payload)
      status, headers, body = Hibana::ENTRYPOINT.call(env)
      {
        "status" => Integer(status),
        "headers" => normalize_headers(headers),
        "body" => Array(body).map(&:to_s).join
      }
    end

    def build_env(payload)
      env = {
        "REQUEST_METHOD" => payload["method"] || "GET",
        "PATH_INFO" => payload["path"] || "/",
        "QUERY_STRING" => payload["query_string"] || "",
        "rack.url_scheme" => payload["scheme"] || "https",
        "rack.version" => [3, 0],
        "rack.input" => StringIO.new(payload["body"] || "", "r"),
        "rack.errors" => $stderr
      }

      if payload["content_type"]
        env["CONTENT_TYPE"] = payload["content_type"]
      end

      if payload["content_length"]
        env["CONTENT_LENGTH"] = payload["content_length"]
      end

      (payload["headers"] || {}).each do |key, value|
        env[header_name(key)] = value
      end

      env
    end

    def normalize_headers(headers)
      headers.each_with_object({}) do |(key, value), memo|
        memo[key.to_s] = value.to_s
      end
    end

    def header_name(key)
      key = key.to_s.upcase.tr("-", "_")
      return key if key == "CONTENT_TYPE" || key == "CONTENT_LENGTH"
      "HTTP_\#{key}"
    end
  end
end
`;
