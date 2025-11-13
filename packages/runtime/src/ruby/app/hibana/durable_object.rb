require "json"

module Hibana
  module DurableObject
    class Context
      attr_reader :binding_name, :state_handle, :namespace

      def initialize(binding_name:, state_handle:, namespace: nil, object_id: nil, object_name: nil)
        @binding_name = binding_name.to_s
        @state_handle = state_handle.to_s
        @namespace = namespace&.to_s
        @object_id = object_id
        @object_name = object_name
        @storage = nil
        @alarms = nil
      end

      def refresh_metadata!(metadata)
        return self if metadata.nil?

        @namespace = metadata["namespace"] if metadata["namespace"]
        @object_id = metadata["object_id"] if metadata.key?("object_id")
        @object_name = metadata["object_name"] if metadata.key?("object_name")
        self
      end

      def object_id
        @object_id
      end

      def object_name
        @object_name
      end

      def storage
        @storage ||= StorageProxy.new(@state_handle)
      end

      def alarms
        @alarms ||= AlarmProxy.new(@state_handle)
      end
    end

    class StorageProxy
      def initialize(state_handle)
        @state_handle = state_handle.to_s
      end

      def get(key, type: nil)
        payload = {
          op: "get",
          key: key,
        }
        payload[:type] = type if type
        HostBridge.durable_object_storage_op(@state_handle, payload)
      end

      def put(key, value, allow_unconfirmed: false, allow_concurrency: false)
        payload = {
          op: "put",
          key: key,
          value: value,
          options: {
            allow_unconfirmed: allow_unconfirmed,
            allow_concurrency: allow_concurrency,
          },
        }
        HostBridge.durable_object_storage_op(@state_handle, payload)
      end

      def delete(key)
        payload = {
          op: "delete",
          key: key,
        }
        HostBridge.durable_object_storage_op(@state_handle, payload)
      end

      def list(prefix: nil, limit: nil, start: nil, finish: nil, reverse: nil)
        options = {
          prefix: prefix,
          limit: limit,
          start: start,
          finish: finish,
          reverse: reverse,
        }.compact
        payload = { op: "list", options: options }
        HostBridge.durable_object_storage_op(@state_handle, payload)
      end
    end

    class AlarmProxy
      def initialize(state_handle)
        @state_handle = state_handle.to_s
      end

      def get
        HostBridge.durable_object_alarm_op(@state_handle, op: "get")
      end

      def set(scheduled_time_ms, allow_unconfirmed: false)
        payload = {
          op: "set",
          scheduled_time: scheduled_time_ms.to_i,
          options: {
            allow_unconfirmed: allow_unconfirmed,
          },
        }
        HostBridge.durable_object_alarm_op(@state_handle, payload)
      end

      def delete
        HostBridge.durable_object_alarm_op(@state_handle, op: "delete")
      end
    end

    class Error < StandardError; end

    class Namespace
      def initialize(binding_name)
        @binding_name = binding_name.to_s
      end

      def fetch(id = nil, name: nil, &block)
        stub = build_stub(id, name)
        return stub.fetch(&block) if block_given?
        stub
      end

      alias get fetch

      private

      def build_stub(id, name)
        target =
          if name
            { "type" => "name", "value" => name.to_s }
          elsif id
            { "type" => "id", "value" => id.to_s }
          else
            raise ArgumentError, "Provide either an id or name"
          end
        Stub.new(@binding_name, target)
      end
    end

    class Response
      attr_reader :status, :headers, :body

      def initialize(payload)
        @status = payload["status"].to_i
        @headers = normalize_headers(payload["headers"])
        @body = payload["body"].to_s
      end

      def ok?
        status >= 200 && status < 300
      end

      def text
        @body
      end

      def json
        JSON.parse(@body)
      rescue JSON::ParserError => e
        raise Error, "Failed to parse JSON response: #{e.message}"
      end

      private

      def normalize_headers(values)
        return {} unless values.is_a?(Hash)
        values.each_with_object({}) do |(key, value), acc|
          next if value.nil?
          acc[key.to_s.downcase] = value.to_s
        end
      end
    end

    class RequestBuilder
      HTTP_METHODS = %i[get post put delete patch head].freeze

      attr_reader :method, :path, :headers, :query, :body, :json

      def self.from_arguments(method, options, &block)
        builder = new
        if block_given?
          builder.instance_eval(&block)
        else
          builder.apply_method(method || :get, options || {})
        end
        builder.to_h
      end

      def initialize
        @method = "GET"
        @path = "/"
        @headers = {}
        @query = nil
        @body = nil
        @json = nil
      end

      HTTP_METHODS.each do |http_method|
        define_method(http_method) do |**options|
          apply_method(http_method, options)
        end
      end

      def to_h
        validate_body_options!
        hash = {
          method: @method,
          path: @path,
        }
        hash[:headers] = @headers unless @headers.empty?
        hash[:query] = @query if @query
        hash[:body] = @body if @body
        hash[:json] = @json if @json
        hash
      end

      private

      def apply_method(http_method, options)
        @method = http_method.to_s.upcase
        @path = options[:path] ? options[:path].to_s : "/"
        @headers = merge_headers(@headers, options[:headers])
        @query = normalize_params(options[:query] || options[:params]) if options[:query] || options[:params]
        @body = options[:body] if options.key?(:body)
        @json = options[:json] if options.key?(:json)
        self
      end

      def merge_headers(existing, additional)
        return existing unless additional
        additional.each_with_object(existing.dup) do |(key, value), acc|
          acc[key.to_s] = value.to_s
        end
      end

      def normalize_params(params)
        return nil if params.nil?
        params.each_with_object({}) do |(key, value), acc|
          if value.is_a?(Array)
            acc[key.to_s] = value.map(&:to_s)
          else
            acc[key.to_s] = value.to_s
          end
        end
      end

      def validate_body_options!
        return unless @body && @json
        raise ArgumentError, "Specify either :body or :json, not both"
      end
    end

    class Stub
      def initialize(binding_name, target)
        @binding_name = binding_name.to_s
        @target = target
      end

      def fetch(method = :get, **options, &block)
        payload = RequestBuilder.from_arguments(method, options, &block)
        result = HostBridge.durable_object_stub_fetch(
          @binding_name,
          @target,
          payload,
        )
        Response.new(result)
      rescue => error
        raise Error, error.message
      end

      def json(...)
        fetch(...).json
      end

      def text(...)
        fetch(...).text
      end

      def ok?(...)
        fetch(...).ok?
      end
    end

    class Base
      class MissingRequestContextError < StandardError; end

      attr_reader :context

      def initialize(context:)
        unless context.is_a?(Hibana::DurableObject::Context)
          raise ArgumentError, "context must be Hibana::DurableObject::Context"
        end
        @context = context
        @__current_request_context = nil
      end

      def storage
        context.storage
      end

      def alarms
        context.alarms
      end

      def fetch(_request)
        raise NotImplementedError, "#{self.class.name} must implement #fetch"
      end

      def alarm
        nil
      end

      def __dispatch_fetch(request_context)
        with_request_context(request_context) do
          fetch(request_context)
        end
      end

      private

      def with_request_context(request_context)
        @__current_request_context = request_context
        yield
      ensure
        @__current_request_context = nil
      end

      def current_request_context
        @__current_request_context
      end

      def ensure_request_context!
        return if current_request_context
        raise MissingRequestContextError, "Request helpers are only available inside #fetch"
      end

      def status
        ensure_request_context!
        current_request_context.status
      end

      def status=(value)
        ensure_request_context!
        current_request_context.status = value
      end

      def json(...)
        ensure_request_context!
        current_request_context.json(...)
      end

      def text(...)
        ensure_request_context!
        current_request_context.text(...)
      end

      def html(...)
        ensure_request_context!
        current_request_context.html(...)
      end

      def redirect(...)
        ensure_request_context!
        current_request_context.redirect(...)
      end

      def render(...)
        ensure_request_context!
        current_request_context.render(...)
      end

      def response(...)
        ensure_request_context!
        current_request_context.response(...)
      end
    end
  end

  module DurableObjects
    class << self
      def register(binding_name, klass, namespace: nil)
        unless klass.is_a?(Class) && klass <= Hibana::DurableObject::Base
          raise ArgumentError, "klass must inherit from Hibana::DurableObject::Base"
        end

        key = binding_name.to_s
        register_namespace_binding(key)
        registry[key] = {
          binding: key,
          klass: klass,
          namespace: namespace&.to_s,
          file: caller_locations(1, 1).first&.path,
        }
      end

      def registry_snapshot
        registry.values.map do |entry|
          {
            "binding" => entry[:binding],
            "class" => entry[:klass].name,
            "namespace" => entry[:namespace],
            "file" => entry[:file],
          }
        end
      end

      def dispatch_fetch(binding_name, state_handle, metadata_json, request_context)
        entry = registry.fetch(binding_name.to_s) do
          raise ArgumentError, "Durable Object '#{binding_name}' is not registered"
        end

        metadata = parse_metadata(metadata_json)
        instance = load_instance(entry, state_handle, metadata)
        payload = normalize_response(
          instance.__dispatch_fetch(request_context),
          request_context: request_context,
        )
        JSON.generate(payload)
      rescue => error
        report_error(error)
        raise
      end

      def dispatch_alarm(binding_name, state_handle, metadata_json = nil)
        entry = registry.fetch(binding_name.to_s) do
          raise ArgumentError, "Durable Object '#{binding_name}' is not registered"
        end

        metadata = parse_metadata(metadata_json)
        instance = load_instance(entry, state_handle, metadata)
        result = instance.alarm
        return if result.nil?
        JSON.generate(normalize_response(result))
      rescue => error
        report_error(error)
        raise
      end

      def release_instance(state_handle)
        instances.delete(state_handle.to_s)
      end

      def normalize_response(result, request_context: nil)
        case result
        when nil
          if request_context
            return request_context.response(
              body: "",
              status: request_context.status,
              headers: {},
            ).payload
          end
          return Response.new(body: "", status: 200).payload
        when Response
          result.payload
        when Hash
          if result.key?("body") && result.key?("status") && result.key?("headers")
            result
          else
            Response.new(body: JSON.generate(result)).payload
          end
        when String
          Response.new(body: result).payload
        else
          Response.new(body: result.to_s).payload
        end
      end

      private

      def registry
        @registry ||= {}
      end

      def instances
        @instances ||= {}
      end

      def load_instance(entry, state_handle, metadata)
        key = state_handle.to_s
        holder = instances[key]
        if holder
          holder[:context].refresh_metadata!(metadata)
          return holder[:instance]
        end

        context = Hibana::DurableObject::Context.new(
          binding_name: entry[:binding],
          state_handle: key,
          namespace: entry[:namespace],
        )
        context.refresh_metadata!(metadata)
        instance = entry[:klass].new(context: context)
        instances[key] = { instance: instance, context: context }
        instance
      end

      def parse_metadata(metadata_json)
        return {} if metadata_json.nil? || metadata_json.empty?
        JSON.parse(metadata_json)
      rescue JSON::ParserError
        {}
      end

      def report_error(error)
        payload = {
          class: error.class.name,
          message: error.message,
          backtrace: error.backtrace,
        }
        HostBridge.report_ruby_error(JSON.generate(payload))
      rescue StandardError
      end

      def register_namespace_binding(key)
        RequestContext.register_binding(key) do |_context, binding_name|
          Hibana::DurableObject::Namespace.new(binding_name)
        end
      end
    end
  end
end
