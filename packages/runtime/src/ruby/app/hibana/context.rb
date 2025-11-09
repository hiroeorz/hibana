require "json"

module Hibana
  module IndifferentAccessHash
    def [](key)
      super(convert_key(key))
    end

    def fetch(key, *args, &block)
      super(convert_key(key), *args, &block)
    end

    def key?(key)
      super(convert_key(key))
    end
    alias include? key?
    alias member? key?
    alias has_key? key?

    private

    def convert_key(key)
      key.is_a?(Symbol) ? key.to_s : key
    end
  end
end

class Response
  attr_reader :body, :status, :headers

  def initialize(body:, status: 200, headers: {})
    @body = body.nil? ? "" : body.to_s
    @status = status.to_i
    @headers = normalize_headers(headers)
  end

  def payload
    {
      "body" => body,
      "status" => status,
      "headers" => headers,
    }
  end

  private

  def normalize_headers(headers)
    return {} if headers.nil?

    headers.each_with_object({}) do |(key, value), acc|
      next if value.nil?
      acc[key.to_s] = value.to_s
    end
  end
end

class EnvBinding
  def initialize(binding_name)
    @binding_name = binding_name.to_s
  end

  def method_missing(name, *args, &block)
    if block
      raise ArgumentError, "Block is not supported for EnvBinding##{name}"
    end

    HostBridge.call_async(@binding_name, name, *args)
  end

  def respond_to_missing?(_name, _include_private = false)
    true
  end
end

class RequestContext
  @binding_factories = {}
  @binding_matchers = []

  TEXT_HEADERS = { "content-type" => "text/plain; charset=UTF-8" }.freeze
  HTML_HEADERS = { "content-type" => "text/html; charset=UTF-8" }.freeze
  JSON_HEADERS = { "content-type" => "application/json; charset=UTF-8" }.freeze

  class << self
    attr_reader :binding_factories, :binding_matchers

    def register_binding(identifier, &factory)
      raise ArgumentError, "Block is required" unless block_given?

      if identifier.is_a?(Regexp)
        binding_matchers << [identifier, factory]
      else
        binding_factories[identifier.to_s] = factory
      end
    end

    def binding_factory_for(name)
      binding_factories[name] ||
        binding_matchers.find { |pattern, _| pattern.match?(name) }&.last
    end
  end

  def initialize
    @bindings = {}
    @path_params = {}
  end

  def env(binding_name = nil)
    return self if binding_name.nil?
    fetch_binding(binding_name)
  end

  def status=(status)
    @status = status
  end

  def status
    @status ||= 200
  end

  def text(body, status: nil, headers: {})
    status = self.status if status.nil?
    Response.new(body: body, status: status, headers: TEXT_HEADERS.merge(headers || {}))
  end

  def html(body, status: nil, headers: {})
    status = self.status if status.nil?
    Response.new(body: body, status: status, headers: HTML_HEADERS.merge(headers || {}))
  end

  def redirect(location, status: 302, headers: {})
    raise ArgumentError, "location is required" if location.nil? || location.to_s.empty?

    normalized_status = status.nil? ? 302 : status.to_i
    redirect_headers = { "Location" => location.to_s }
    Response.new(
      body: "",
      status: normalized_status,
      headers: redirect_headers.merge(headers || {}),
    )
  end

  def render(template, locals: nil, layout: :default, status: nil, headers: {}, **implicit_locals)
    body = render_to_string(template, locals: locals, layout: layout, **implicit_locals)
    Response.new(
      body: body,
      status: status || self.status,
      headers: HTML_HEADERS.merge(headers || {}),
    )
  end

  def render_to_string(template, locals: nil, layout: :default, **implicit_locals)
    assigns = build_render_assigns(locals, implicit_locals)
    Hibana::Renderer.render(
      template,
      context: self,
      locals: assigns,
      layout: layout,
    )
  end

  def json(data = nil, status: 200, headers: {}, **keyword_data)
    payload = if !keyword_data.empty?
      keyword_data
    elsif data.nil?
      {}
    else
      data
    end

    Response.new(
      body: JSON.generate(payload),
      status: status,
      headers: JSON_HEADERS.merge(headers || {}),
    )
  end

  def response(body:, status: 200, headers: {})
    Response.new(body: body, status: status, headers: headers || {})
  end

  def query
    @query ||= {}
  end

  def params
    build_params_hash
  end

  def path_params
    @path_params.dup.freeze
  end

  def path_param(name)
    @path_params[normalize_param_key(name)]
  end

  def set_path_params(values)
    @path_params = normalize_shallow_params(values)
  end

  def set_query_from_json(json)
    if json.nil? || json.empty?
      @query = {}
      return
    end

    parsed = JSON.parse(json)
    @query = normalize_query(parsed)
  rescue JSON::ParserError
    @query = {}
  end

  def content_type
    @content_type
  end

  def set_content_type(value)
    @content_type = value.nil? || value.empty? ? nil : value.to_s
  end

  def raw_body
    @raw_body
  end

  def set_raw_body(value)
    @raw_body = value.nil? ? "" : value.to_s
  end

  def json_body
    @json_body ||= nil
  end

  def set_json_body(value)
    if value.nil? || value.empty?
      @json_body = nil
      return
    end

    @json_body = JSON.parse(value)
  rescue JSON::ParserError
    @json_body = nil
  end

  def form_body
    @form_body ||= nil
  end

  def set_form_body(value)
    if value.nil? || value.empty?
      @form_body = nil
      return
    end

    parsed = JSON.parse(value)
    @form_body = normalize_query(parsed)
  rescue JSON::ParserError
    @form_body = nil
  end

  def method_missing(name, *args, &block)
    return fetch_binding(name) if args.empty? && block.nil?
    super
  end

  def respond_to_missing?(_name, _include_private = false)
    true
  end

  private

  def fetch_binding(binding_name)
    key = binding_name.to_s

    @bindings[key] ||= begin
      factory = self.class.binding_factory_for(key)
      if factory
        factory.call(self, key)
      else
        EnvBinding.new(key)
      end
    end
  end

  def normalize_query(value)
    case value
    when Hash
      value.each_with_object({}) do |(k, v), acc|
        acc[k.to_s] = normalize_query(v)
      end
    when Array
      value.map { |item| normalize_query(item) }
    else
      value
    end
  end

  def build_render_assigns(explicit_locals, implicit_locals)
    assigns = {}
    if explicit_locals
      unless explicit_locals.respond_to?(:each)
        raise ArgumentError, "locals must be provided as a hash-like object"
      end
      explicit_locals.each do |key, value|
        assigns[key] = value
      end
    end
    implicit_locals.each do |key, value|
      assigns[key] = value
    end
    assigns
  end

  def build_params_hash
    merged = query.merge(@path_params) { |_key, _old, new| new }
    merged.extend(Hibana::IndifferentAccessHash)
    merged.freeze
  end

  def normalize_shallow_params(values)
    return {} if values.nil? || values.empty?

    values.each_with_object({}) do |(key, value), acc|
      acc[key.to_s] = value
    end
  end

  def normalize_param_key(key)
    key.is_a?(Symbol) ? key.to_s : key
  end
end
