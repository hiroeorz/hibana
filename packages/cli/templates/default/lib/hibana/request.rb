# frozen_string_literal: true

require 'json'
require 'uri'

module Hibana
  class Request
    attr_reader :env, :params

    def initialize(env, params: {})
      @env = env
      @params = stringify_keys(params)
    end

    def method
      env['REQUEST_METHOD'].to_s.upcase
    end

    def path
      value = env['PATH_INFO']
      value.nil? || value.empty? ? '/' : value
    end

    def query_string
      env['QUERY_STRING'].to_s
    end

    def query_params
      @query_params ||= parse_query_string(query_string)
    end

    def query(key)
      query_params[key.to_s]
    end

    def param(key)
      params[key.to_s]
    end

    def header(name)
      normalized = name.to_s.upcase.tr('-', '_')
      return env['CONTENT_TYPE'] if normalized == 'CONTENT_TYPE'
      return env['CONTENT_LENGTH'] if normalized == 'CONTENT_LENGTH'

      env["HTTP_#{normalized}"]
    end

    def body
      return @body if defined?(@body)

      input = env['rack.input']
      @body = if input.respond_to?(:read)
        input.rewind if input.respond_to?(:rewind)
        data = input.read || ''
        input.rewind if input.respond_to?(:rewind)
        data
      else
        ''
      end
    end

    def json
      raw = body
      return {} if raw.nil? || raw.empty?

      JSON.parse(raw)
    rescue JSON::ParserError => e
      raise Hibana::BadRequestError, "Invalid JSON payload: #{e.message}"
    end

    private

    def stringify_keys(hash)
      hash.each_with_object({}) do |(key, value), memo|
        memo[key.to_s] = value
      end
    end

    def parse_query_string(string)
      return {} if string.nil? || string.empty?

      URI.decode_www_form(string).each_with_object({}) do |(key, value), memo|
        memo[key] = value
      end
    rescue StandardError
      {}
    end
  end
end
