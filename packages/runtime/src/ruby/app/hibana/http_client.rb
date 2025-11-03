require "json"
require "uri"
require "base64"

module Http
  class Error < StandardError
    attr_reader :details

    def initialize(message, details = {})
      super(message)
      @details = details || {}
    end
  end

  class Response
    attr_reader :status, :status_text, :headers, :body, :url, :response_type

    def initialize(payload)
      @status = payload.fetch("status").to_i
      @status_text = payload.fetch("statusText").to_s
      @headers = normalize_headers(payload["headers"])
      @response_type = payload.fetch("responseType", "text")
      @url = payload.fetch("url").to_s
      @body = decode_body(payload)
    end

    def success?
      status >= 200 && status < 300
    end

    def json
      JSON.parse(body)
    rescue JSON::ParserError => e
      raise Error.new("Response body is not valid JSON", { cause: e.message })
    end

    private

    def normalize_headers(value)
      return {} unless value.is_a?(Hash)

      value.each_with_object({}) do |(key, header_value), acc|
        next if key.nil?
        acc[key.to_s] = header_value.nil? ? "" : header_value.to_s
      end
    end

    def decode_body(payload)
      body = payload.fetch("body", "")
      base64 = payload["base64"] == true
      return body.to_s unless base64

      Base64.decode64(body.to_s)
    end
  end

  class Client
    def get(url, **options)
      request(:get, url, **options)
    end

    def post(url, **options)
      request(:post, url, **options)
    end

    private

    def request(method, url, headers: {}, query: nil, body: nil, json: nil, form: nil,
      timeout_ms: nil, response_type: nil)
      raise ArgumentError, "URL is required" if url.nil? || url.to_s.empty?

      request_body, updated_headers = build_body(headers, body, json, form, method)
      final_url = build_url(url, query)
      payload = {
        url: final_url,
        method: method.to_s.upcase,
        headers: normalize_headers(updated_headers),
      }
      payload[:body] = request_body if request_body
      payload[:timeoutMs] = timeout_ms.to_i if timeout_ms && timeout_ms.to_i.positive?
      if response_type
        response_type_str = response_type.to_s
        unless %w[text json arrayBuffer].include?(response_type_str)
          raise ArgumentError, "response_type must be one of text, json, or arrayBuffer"
        end
        payload[:responseType] = response_type_str
      end

      response_payload = dispatch(payload)
      Http::Response.new(response_payload)
    end

    def dispatch(payload)
      payload_json = JSON.generate(payload)
      result = HostBridge.http_fetch(payload_json)
      result_json = if result.respond_to?(:to_str)
        result.to_str
      else
        result.to_s
      end
      parsed = JSON.parse(result_json)
      unless parsed.is_a?(Hash)
        raise Error.new("HTTP fetch result is malformed", { payload: parsed })
      end
      if parsed["ok"] != true
        details = parsed["error"].is_a?(Hash) ? parsed["error"] : { "message" => parsed["error"].to_s }
        raise Error.new(details["message"] || "HTTP fetch failed", details)
      end
      parsed
    rescue JSON::ParserError => e
      raise Error.new("Failed to parse HTTP fetch response", { cause: e.message })
    end

    def normalize_headers(headers)
      return {} if headers.nil?

      headers.each_with_object({}) do |(key, value), acc|
        next if key.nil?
        acc[key.to_s] = value.to_s
      end
    end

    def build_body(headers, body, json, form, method)
      normalized_headers = normalize_headers(headers)
      if json
        normalized_headers["content-type"] ||= "application/json"
        return JSON.generate(json), normalized_headers
      end

      if form
        unless form.is_a?(Hash)
          raise ArgumentError, "form payload must be provided as a hash"
        end
        normalized_headers["content-type"] ||= "application/x-www-form-urlencoded"
        encoded_form = URI.encode_www_form(flatten_form(form))
        return encoded_form, normalized_headers
      end

      return [nil, normalized_headers] if method.to_s.casecmp("get").zero? || body.nil?

      [body.to_s, normalized_headers]
    end

    def build_url(url, query)
      base = url.to_s
      return base if query.nil? || query == ""

      query_string = case query
      when String
        query.start_with?("?") ? query[1..] : query
      when Hash
        pairs = flatten_query(query)
        URI.encode_www_form(pairs)
      when Array
        query.map { |key, value| [key.to_s, value.to_s] }.then { |pairs| URI.encode_www_form(pairs) }
      else
        query.to_s
      end

      return base if query_string.nil? || query_string.empty?

      separator = base.include?("?") ? "&" : "?"
      "#{base}#{separator}#{query_string}"
    rescue URI::InvalidComponentError
      base
    end

    def flatten_query(value, prefix = nil)
      case value
      when Hash
        value.flat_map do |key, v|
          key_str = prefix ? "#{prefix}[#{key}]" : key.to_s
          flatten_query(v, key_str)
        end
      when Array
        value.flat_map.with_index do |item, index|
          key_str = "#{prefix}[#{index}]"
          flatten_query(item, key_str)
        end
      else
        key = prefix || raise(ArgumentError, "Query parameters must be provided as a hash or array")
        [[key, value.to_s]]
      end
    end

    def flatten_form(value, prefix = nil)
      case value
      when Hash
        value.each_with_object({}) do |(key, v), acc|
          key_str = prefix ? "#{prefix}[#{key}]" : key.to_s
          acc.merge!(flatten_form(v, key_str))
        end
      when Array
        value.each_with_index.with_object({}) do |(item, index), acc|
          key_str = "#{prefix}[#{index}]"
          acc.merge!(flatten_form(item, key_str))
        end
      else
        key = prefix || raise(ArgumentError, "Form payload must be a hash with keys")
        { key => value.to_s }
      end
    end
  end

  class << self
    def client
      Client.new
    end

    def get(url, **options)
      client.get(url, **options)
    end

    def post(url, **options)
      client.post(url, **options)
    end

    def register_binding(identifier = "HTTP")
      RequestContext.register_binding(identifier) do |_context, _binding_name|
        Client.new
      end
    end
  end
end

Http.register_binding("HTTP")
