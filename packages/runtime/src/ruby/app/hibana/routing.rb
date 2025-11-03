# frozen_string_literal: true

require "json"

# ルート定義を保存するハッシュ
@routes = Hash.new { |h, k| h[k] = {} }

# get "/path" do |c| ... end 形式のDSLを定義
def get(path, &block)
  @routes["GET"][path] = block
end

def post(path, &block)
  @routes["POST"][path] = block
end

def normalize_response(result)
  case result
  when Response
    result
  when Hash
    Response.new(
      body: result[:body] || result["body"],
      status: result[:status] || result["status"] || 200,
      headers: result[:headers] || result["headers"] || {},
    )
  when NilClass
    Response.new(body: "", status: 204)
  else
    Response.new(
      body: result.to_s,
      status: 200,
      headers: { "content-type" => "text/plain; charset=UTF-8" },
    )
  end
end

# リクエストを処理する関数
def dispatch(method, path, context)
  block = @routes[method][path]
  response =
    if block
      normalize_response(block.call(context))
    else
      Response.new(
        body: "Ruby Router: Not Found",
        status: 404,
        headers: { "content-type" => "text/plain; charset=UTF-8" },
      )
    end

  JSON.generate(response.payload)
rescue => error
  report_dispatch_error(error)
end

def report_dispatch_error(error)
  payload = {
    message: error.message,
    class: error.class.name,
    backtrace: error.backtrace,
  }

  begin
    HostBridge.report_ruby_error(JSON.generate(payload))
  rescue => report_error
    warn "Ruby Router: failed to report error - #{report_error.message}"
  end

  fallback = Response.new(
    body: "Ruby Router: Internal Server Error",
    status: 500,
    headers: { "content-type" => "text/plain; charset=UTF-8" },
  )

  JSON.generate(fallback.payload)
end
