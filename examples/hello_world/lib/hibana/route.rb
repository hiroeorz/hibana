# frozen_string_literal: true

module Hibana
  class Route
    attr_reader :http_method, :path_template, :block

    def initialize(http_method, path_template, block)
      raise ArgumentError, 'Route block is required' unless block

      @http_method = http_method.to_s.upcase
      @path_template = path_template
      @block = block
      @pattern, @captures = compile(path_template)
    end

    def match?(request_method, path)
      return unless http_method == request_method

      match = @pattern.match(path)
      return unless match

      params = {}
      @captures.each do |name|
        params[name] = match[name]
      end
      params
    end

    def call(context)
      block.call(context)
    end

    private

    def compile(path)
      return [%r{\A/\z}, []] if path == '/'

      segments = path.split('/').reject(&:empty?)
      captures = []

      pattern = segments.map do |segment|
        if segment.start_with?(':')
          name = segment.delete_prefix(':')
          captures << name
          "(?<#{name}>[^/]+)"
        else
          Regexp.escape(segment)
        end
      end.join('/')

      [%r{\A/#{pattern}\z}, captures]
    end
  end
end
