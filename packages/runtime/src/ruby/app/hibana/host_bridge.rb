require "json"

module HostBridge
  class << self
    attr_accessor :ts_call_binding,
      :ts_run_d1_query,
      :ts_http_fetch,
      :ts_workers_ai_invoke,
      :ts_report_ruby_error,
      :ts_html_rewriter_transform,
      :ts_durable_object_storage_op,
      :ts_durable_object_alarm_op

    def call(binding_name, method_name, *args)
      ensure_call_binding_registered!
      ts_call_binding.apply(binding_name.to_s, method_name.to_s, args)
    end

    def call_async(binding_name, method_name, *args)
      result = call(binding_name, method_name, *args)
      if result.respond_to?(:await)
        result.await
      else
        result
      end
    end

    def run_d1_query(binding_name, sql, bindings, action)
      unless ts_run_d1_query
        raise "Host function 'ts_run_d1_query' is not registered"
      end
      result = ts_run_d1_query.apply(binding_name.to_s, sql, bindings, action).await
      result.is_a?(String) ? result : result.to_s
    end

    def http_fetch(request_payload)
      unless ts_http_fetch
        raise "Host function 'ts_http_fetch' is not registered"
      end
      result = ts_http_fetch.apply(request_payload.to_s)
      if result.respond_to?(:await)
        result.await
      else
        result
      end
    end

    def workers_ai_invoke(request_payload)
      unless ts_workers_ai_invoke
        raise "Host function 'ts_workers_ai_invoke' is not registered"
      end
      result = ts_workers_ai_invoke.apply(request_payload.to_s)
      if result.respond_to?(:await)
        result.await
      else
        result
      end
    end

    def report_ruby_error(request_payload)
      unless ts_report_ruby_error
        raise "Host function 'ts_report_ruby_error' is not registered"
      end
      result = ts_report_ruby_error.apply(request_payload.to_s)
      if result.respond_to?(:await)
        result.await
      else
        result
      end
    end

    def html_rewriter_transform(request_payload)
      unless ts_html_rewriter_transform
        raise "Host function 'ts_html_rewriter_transform' is not registered"
      end
      result = ts_html_rewriter_transform.apply(request_payload.to_s)
      if result.respond_to?(:await)
        result.await
      else
        result
      end
    end

    private

    def ensure_call_binding_registered!
      unless ts_call_binding
        raise "Host function 'ts_call_binding' is not registered"
      end
    end

    def ensure_host_function!(name, fn)
      unless fn
        raise "Host function '#{name}' is not registered"
      end
    end
  end

  class << self
    def durable_object_storage_op(state_handle, payload)
      ensure_host_function!("ts_durable_object_storage_op", ts_durable_object_storage_op)
      payload_json = JSON.generate(payload || {})
      result = ts_durable_object_storage_op.apply(state_handle.to_s, payload_json)
      parse_host_response(result)
    end

    def durable_object_alarm_op(state_handle, payload)
      ensure_host_function!("ts_durable_object_alarm_op", ts_durable_object_alarm_op)
      payload_json = JSON.generate(payload || {})
      result = ts_durable_object_alarm_op.apply(state_handle.to_s, payload_json)
      parse_host_response(result)
    end

    private

    def parse_host_response(result)
      serialized =
        if result.respond_to?(:await)
          result.await
        else
          result
        end
      data =
        if serialized.nil? || serialized.to_s.empty?
          {}
        else
          JSON.parse(serialized.to_s)
        end
      if data.is_a?(Hash) && data["ok"]
        data["result"]
      elsif data.is_a?(Hash)
        error = data["error"] || {}
        message = error["message"] || "Durable Object host operation failed"
        raise message
      else
        raise "Durable Object host response is malformed"
      end
    rescue JSON::ParserError => e
      raise "Failed to parse Durable Object host response: #{e.message}"
    end
  end
end
