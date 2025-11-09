# frozen_string_literal: true

require "json"

module HibanaRouterState
  class << self
    attr_accessor :routes, :route_sequence
  end
end

# ルート定義を保存するハッシュ
HibanaRouterState.routes = Hash.new do |hash, key|
  hash[key] = {
    static: {},
    dynamic: [],
    regex: [],
  }
end
HibanaRouterState.route_sequence = 0

def reset_routes!
  HibanaRouterState.routes.clear
  HibanaRouterState.route_sequence = 0
end

def get(path_or_pattern, &block)
  register_route("GET", path_or_pattern, &block)
end

def post(path_or_pattern, &block)
  register_route("POST", path_or_pattern, &block)
end

def register_route(method, path_or_pattern, &block)
  raise ArgumentError, "Block is required for route definition" unless block_given?
  routes = HibanaRouterState.routes[method]

  case path_or_pattern
  when String
    if dynamic_route?(path_or_pattern)
      route = compile_dynamic_route(path_or_pattern, block)
      routes[:dynamic] << route
      routes[:dynamic].sort_by! { |entry| dynamic_route_sort_key(entry) }
    else
      routes[:static][path_or_pattern] = block
    end
  when Regexp
    ensure_named_captures!(path_or_pattern)
    routes[:regex] << {
      pattern: path_or_pattern,
      block: block,
      order: next_route_sequence,
    }
  else
    raise ArgumentError, "Route path must be provided as String or Regexp"
  end
end

def dynamic_route?(path)
  path.include?(":") || path.include?("*")
end

def compile_dynamic_route(path, block)
  raise ArgumentError, "Route path must start with '/'" unless path.start_with?("/")

  segments = path.split("/")
  splat_used = false
  specificity = 0
  segment_count = segments.count { |segment| !segment.empty? }
  names = {}

  pattern_segments =
    segments.map.with_index do |segment, index|
      if segment.start_with?(":")
        name = segment.delete_prefix(":")
        raise ArgumentError, "Unnamed parameter segment detected in '#{path}'" if name.empty?
        raise ArgumentError, "Duplicate parameter '#{name}' in '#{path}'" if names.key?(name)
        names[name] = true
        "(?<#{name}>[^/]+)"
      elsif segment.start_with?("*")
        name = segment.delete_prefix("*")
        raise ArgumentError, "Unnamed splat segment detected in '#{path}'" if name.empty?
        raise ArgumentError, "Splat segment must appear at the end of '#{path}'" unless terminal_segment?(segments, index)
        raise ArgumentError, "Only one splat segment is allowed per route '#{path}'" if splat_used
        splat_used = true
        names[name] = true
        "(?<#{name}>.*)"
      else
        specificity += 1 unless segment.empty?
        Regexp.escape(segment)
      end
    end

  pattern = pattern_segments.join("/")
  matcher = Regexp.new("\\A#{pattern}\\z")

  {
    matcher: matcher,
    block: block,
    specificity: specificity,
    segment_count: segment_count,
    order: next_route_sequence,
  }
end

def dynamic_route_sort_key(route)
  [
    -route[:specificity],
    -route[:segment_count],
    route[:order],
  ]
end

def ensure_named_captures!(pattern)
  return unless pattern.names.empty?
  raise ArgumentError, "Regexp routes must include at least one named capture"
end

def terminal_segment?(segments, index)
  ((index + 1)...segments.length).all? { |idx| segments[idx].empty? }
end

def next_route_sequence
  HibanaRouterState.route_sequence += 1
end

def find_route(method, path)
  route_set = HibanaRouterState.routes[method]
  return nil unless route_set

  if (block = route_set[:static][path])
    return { block: block, params: {} }
  end

  route_set[:dynamic].each do |route|
    match = route[:matcher].match(path)
    next unless match
    return {
      block: route[:block],
      params: stringify_params(match.named_captures),
    }
  end

  route_set[:regex].each do |route|
    match = route[:pattern].match(path)
    next unless match
    return {
      block: route[:block],
      params: stringify_params(match.named_captures),
    }
  end

  nil
end

def stringify_params(hash)
  hash.each_with_object({}) do |(key, value), acc|
    acc[key.to_s] = value
  end
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
  route = find_route(method, path)
  response =
    if route
      context.set_path_params(route[:params]) if context.respond_to?(:set_path_params)
      normalize_response(route[:block].call(context))
    else
      context.set_path_params({}) if context.respond_to?(:set_path_params)
      serve_static(path) ||
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

def serve_static(path)
  static_server.call(path)
rescue => error
  warn "Static server error: #{error.message}"
  nil
end

def static_server
  @static_server ||= Hibana::StaticServer.new
end
