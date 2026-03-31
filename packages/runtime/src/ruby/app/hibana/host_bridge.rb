require "json"

module HostBridge
  class D1QueryError < StandardError
    attr_reader :details

    def initialize(message, details = nil)
      super(message)
      @details = details || {}
    end
  end

  class << self
    attr_accessor :ts_call_binding,
      :ts_run_d1_query,
      :ts_http_fetch,
      :ts_workers_ai_invoke,
      :ts_vectorize_invoke,
      :ts_report_ruby_error,
      :ts_html_rewriter_transform,
      :ts_durable_object_storage_op,
      :ts_durable_object_alarm_op,
      :ts_durable_object_stub_fetch,
      :ts_queue_message_op,
      :ts_queue_batch_op

    def call(binding_name, method_name, *args)
      ensure_host_function!(:ts_call_binding)
      ts_call_binding.apply(binding_name.to_s, method_name.to_s, args)
    end

    def call_async(binding_name, method_name, *args)
      await_if_needed(call(binding_name, method_name, *args))
    end

    def run_d1_query(binding_name, sql, bindings, action)
      ensure_host_function!(:ts_run_d1_query)
      serialized = invoke_host_function(ts_run_d1_query, binding_name.to_s, sql, bindings, action)
      parse_d1_response(serialized)
    end

    def http_fetch(request_payload)
      ensure_host_function!(:ts_http_fetch)
      await_if_needed(ts_http_fetch.apply(request_payload.to_s))
    end

    def workers_ai_invoke(request_payload)
      ensure_host_function!(:ts_workers_ai_invoke)
      await_if_needed(ts_workers_ai_invoke.apply(request_payload.to_s))
    end

    def vectorize_invoke(payload)
      ensure_host_function!(:ts_vectorize_invoke)
      payload_json = JSON.generate(payload || {})
      result = ts_vectorize_invoke.apply(payload_json)
      parse_host_response(result, context: "Vectorize operation failed")
    end

    def report_ruby_error(request_payload)
      ensure_host_function!(:ts_report_ruby_error)
      await_if_needed(ts_report_ruby_error.apply(request_payload.to_s))
    end

    def html_rewriter_transform(request_payload)
      ensure_host_function!(:ts_html_rewriter_transform)
      await_if_needed(ts_html_rewriter_transform.apply(request_payload.to_s))
    end

    def durable_object_storage_op(state_handle, payload)
      ensure_host_function!(:ts_durable_object_storage_op)
      payload_json = JSON.generate(payload || {})
      result = ts_durable_object_storage_op.apply(state_handle.to_s, payload_json)
      parse_host_response(result, context: "Durable Object host operation failed")
    end

    def durable_object_alarm_op(state_handle, payload)
      ensure_host_function!(:ts_durable_object_alarm_op)
      payload_json = JSON.generate(payload || {})
      result = ts_durable_object_alarm_op.apply(state_handle.to_s, payload_json)
      parse_host_response(result, context: "Durable Object host operation failed")
    end

    def durable_object_stub_fetch(binding_name, target, request_payload)
      ensure_host_function!(:ts_durable_object_stub_fetch)
      payload = {
        binding: binding_name.to_s,
        target: normalize_target(target),
        request: request_payload || {},
      }
      payload_json = JSON.generate(payload)
      result = ts_durable_object_stub_fetch.apply(payload_json)
      parse_host_response(result, context: "Durable Object host operation failed")
    end

    def queue_message_op(payload)
      ensure_host_function!(:ts_queue_message_op)
      payload_json = JSON.generate(payload || {})
      result = ts_queue_message_op.apply(payload_json)
      parse_host_response(result, context: "Queue message operation failed")
    end

    def queue_batch_op(payload)
      ensure_host_function!(:ts_queue_batch_op)
      payload_json = JSON.generate(payload || {})
      result = ts_queue_batch_op.apply(payload_json)
      parse_host_response(result, context: "Queue batch operation failed")
    end

    private

    def await_if_needed(result)
      result.respond_to?(:await) ? result.await : result
    end

    def ensure_host_function!(name)
      fn = send(name)
      raise "Host function '#{name}' is not registered" unless fn
    end

    def invoke_host_function(fn, *args)
      await_if_needed(fn.apply(*args))
    end

    def parse_host_response(result, context:)
      serialized = await_if_needed(result)
      data = parse_json_safe(serialized)

      if data.is_a?(Hash) && data["ok"]
        data["result"]
      elsif data.is_a?(Hash)
        error = data["error"] || {}
        message = error["message"] || context
        raise message
      else
        raise "#{context}: response is malformed"
      end
    rescue JSON::ParserError => e
      raise "Failed to parse host response: #{e.message}"
    end

    def parse_d1_response(serialized)
      data = parse_json_safe(serialized)

      if data.is_a?(Hash) && data["ok"]
        data["result"]
      elsif data.is_a?(Hash)
        error = data["error"].is_a?(Hash) ? data["error"] : {}
        message = error["message"] || "D1 query failed"
        raise D1QueryError.new(message, error)
      else
        raise D1QueryError.new("D1 query failed: response is malformed")
      end
    rescue JSON::ParserError => e
      raise D1QueryError.new("Failed to parse D1 response: #{e.message}")
    end

    def parse_json_safe(serialized)
      return {} if serialized.nil? || serialized.to_s.empty?
      JSON.parse(serialized.to_s)
    end

    def normalize_target(target)
      return target if target.is_a?(Hash)
      raise ArgumentError, "Durable Object target must be provided as a hash"
    end
  end
end
