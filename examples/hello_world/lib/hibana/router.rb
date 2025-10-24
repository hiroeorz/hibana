# frozen_string_literal: true

module Hibana
  class Router
    SUPPORTED_METHODS = %w[GET POST PUT PATCH DELETE OPTIONS HEAD].freeze

    attr_reader :routes

    def initialize
      @routes = []
    end

    SUPPORTED_METHODS.each do |verb|
      define_method(verb.downcase) do |path, &block|
        add_route(verb, path, block)
      end
    end

    def add_route(method, path, block)
      routes << Route.new(method, path, block)
    end

    def call(env)
      request = Request.new(env)

      routes.each do |route|
        params = route.match?(request.method, request.path)
        next unless params

        response = Response.new
        context = Context.new(
          request: Request.new(env, params: params),
          response: response,
          env: env,
          params: params
        )

        result = execute_route(route, context)
        return normalize_response(result, context)
      rescue Hibana::BadRequestError => e
        return error_response(400, 'Bad Request', detail: e.message)
      rescue StandardError => e
        return error_response(500, 'Internal Server Error', detail: e.message)
      end

      error_response(404, 'Not Found')
    end

    private

    def execute_route(route, context)
      route.call(context)
    end

    def normalize_response(result, context)
      return result if rack_triplet?(result)
      return result.finish if result.is_a?(Response)

      context.res.finish
    end

    def rack_triplet?(value)
      value.is_a?(Array) && value.length == 3
    end

    def error_response(status, message, detail: nil)
      response = Response.new
      response.status = status
      response.text(detail ? "#{message}: #{detail}" : message)
      response.finish
    end
  end
end
