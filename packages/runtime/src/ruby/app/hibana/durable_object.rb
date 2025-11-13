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
    end
  end
end
