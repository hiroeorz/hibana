# frozen_string_literal: true

require 'json'

module Hibana
  class Context
    attr_reader :request, :response, :env

    def initialize(request:, response:, env:, params:)
      @request = request
      @response = response
      @env = env
      @params = stringify_keys(params)
    end

    def req
      request
    end

    def res
      response
    end

    def param(name)
      @params[name.to_s]
    end

    def params
      @params.dup
    end

    def query(name)
      request.query(name)
    end

    def status(code)
      response.status = Integer(code)
    end

    def text(body, status: nil)
      response.text(body, status: status)
    end

    def json(payload, status: nil)
      response.json(payload, status: status)
    end

    def header(key, value)
      response.headers[key.to_s] = value.to_s
    end

    private

    def stringify_keys(hash)
      hash.each_with_object({}) do |(key, value), memo|
        memo[key.to_s] = value
      end
    end
  end
end
