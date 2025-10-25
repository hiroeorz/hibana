# frozen_string_literal: true

require 'json'

module Hibana
  class Response
    attr_reader :headers
    attr_accessor :status

    def initialize
      @status = 200
      @headers = {}
      @body_chunks = []
    end

    def body=(value)
      @body_chunks = [value.to_s]
    end

    def body
      @body_chunks
    end

    def write(chunk)
      @body_chunks << chunk.to_s
    end

    def merge_headers(hash)
      hash.each do |key, value|
        headers[key.to_s] = value.to_s
      end
    end

    def text(content, status: nil)
      self.status = status if status
      headers['content-type'] ||= 'text/plain; charset=utf-8'
      self.body = content
      content
    end

    def json(payload = nil, status: nil, **payload_kwargs)
      final_payload =
        if payload_kwargs.empty?
          payload
        elsif payload.nil?
          payload_kwargs
        else
          raise ArgumentError, 'payload must be provided either as a positional argument or keyword hash, not both'
        end

      self.status = status if status
      headers['content-type'] ||= 'application/json; charset=utf-8'
      self.body = JSON.generate(final_payload)
    end

    def finish
      [status, headers, body.empty? ? [''] : body]
    end
  end
end
