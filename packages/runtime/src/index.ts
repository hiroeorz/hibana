import "./polyfills"
import { handleRequest } from "./ruby-runtime"
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
export { handleRequest }

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

const runtime = { fetch: runtimeFetch }

export default runtime
