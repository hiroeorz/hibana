require "json"

module WorkersAI
  class Error < StandardError
    attr_reader :details

    def initialize(message, details = {})
      super(message)
      @details = details || {}
    end
  end

  class Client
    def initialize(binding_name)
      @binding_name = binding_name.to_s
    end

    def run(model:, payload: {})
      raise ArgumentError, "model is required" if model.nil? || model.to_s.empty?
      raise ArgumentError, "payload must be a hash" unless payload.is_a?(Hash)

      request = {
        binding: @binding_name,
        model: model.to_s,
        payload: stringify_keys(payload),
      }

      dispatch(request)
    end

    def generate_text(model:, prompt:)
      run(
        model: model,
        payload: { prompt: prompt.to_s },
      )
    end

    def invoke(payload)
      unless payload.is_a?(Hash)
        raise ArgumentError, "payload must be a hash"
      end
      request = stringify_keys(payload)
      request["binding"] = @binding_name
      dispatch(request)
    end

    private

    def dispatch(payload)
      payload_json = JSON.generate(payload)
      result = HostBridge.workers_ai_invoke(payload_json)
      result_json = convert_to_string(result)
      parse_response(result_json)
    rescue JSON::GeneratorError => e
      raise Error.new("Failed to encode Workers AI request", { cause: e.message })
    end

    def parse_response(result_json)
      parsed = JSON.parse(result_json)
      unless parsed.is_a?(Hash)
        raise Error.new("Workers AI response is malformed", { payload: parsed })
      end
      if parsed["ok"] != true
        details = parsed["error"].is_a?(Hash) ? parsed["error"] : { "message" => parsed["error"].to_s }
        message = details["message"] || "Workers AI invocation failed"
        raise Error.new(message, details)
      end
      parsed["result"]
    rescue JSON::ParserError => e
      raise Error.new("Failed to parse Workers AI response", { cause: e.message })
    end

    def convert_to_string(value)
      if value.respond_to?(:to_str)
        value.to_str
      else
        value.to_s
      end
    end

    def stringify_keys(hash)
      hash.each_with_object({}) do |(key, value), acc|
        acc[key.to_s] = value
      end
    end
  end

  class << self
    def register_binding(identifier)
      RequestContext.register_binding(identifier) do |_context, binding_name|
        Client.new(binding_name)
      end
    end
  end
end
