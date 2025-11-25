require "json"

module Hibana
  module PubSub
    DEFAULT_TEXT_CONTENT_TYPE = "text/plain"
    DEFAULT_JSON_CONTENT_TYPE = "application/json"
    DEFAULT_BINDING_PATTERN = /PUBSUB$/.freeze

    class Broker
      def initialize(binding_name)
        @binding_name = binding_name.to_s
      end

      def publish(topic, body, content_type: nil, qos: nil, retain: nil, properties: nil)
        normalized_topic = normalize_topic(topic)
        normalized_body, inferred_type = normalize_body(body)
        options = build_options(
          content_type: content_type,
          inferred_type: inferred_type,
          qos: qos,
          retain: retain,
          properties: properties,
        )
        args = [normalized_topic, normalized_body]
        args << options unless options.empty?
        HostBridge.call_async(@binding_name, :publish, *args)
      end

      private

      def normalize_topic(topic)
        value = topic.to_s
        raise ArgumentError, "topic is required" if value.empty?
        value
      end

      def normalize_body(body)
        case body
        when nil
          [JSON.generate(nil), DEFAULT_JSON_CONTENT_TYPE]
        when String
          [body, DEFAULT_TEXT_CONTENT_TYPE]
        when Numeric, TrueClass, FalseClass
          [JSON.generate(body), DEFAULT_JSON_CONTENT_TYPE]
        when Array
          [JSON.generate(body), DEFAULT_JSON_CONTENT_TYPE]
        else
          hash_like = hash_like?(body) ? body.to_h : nil

          if hash_like
            [JSON.generate(hash_like), DEFAULT_JSON_CONTENT_TYPE]
          else
            [body.to_s, DEFAULT_TEXT_CONTENT_TYPE]
          end

        end
      rescue JSON::GeneratorError => error
        raise ArgumentError, "Failed to serialize pubsub message: #{error.message}"
      end

      def hash_like?(value)
        value.respond_to?(:to_h)
      end

      def build_options(content_type:, inferred_type:, qos:, retain:, properties:)
        options = {}
        normalized_content_type = normalize_content_type(content_type, inferred_type)
        options[:contentType] = normalized_content_type if normalized_content_type

        normalized_qos = normalize_qos(qos)
        options[:qos] = normalized_qos unless normalized_qos.nil?

        normalized_retain = normalize_retain(retain)
        options[:retain] = normalized_retain unless normalized_retain.nil?

        normalized_properties = normalize_properties(properties)
        options[:properties] = normalized_properties if normalized_properties

        options
      end

      def normalize_content_type(explicit, fallback)
        value = explicit || fallback
        return nil if value.nil?
        stringified = value.to_s.strip
        stringified.empty? ? nil : stringified
      end

      def normalize_qos(qos)
        return nil if qos.nil?
        value =
          begin
            Integer(qos)
          rescue ArgumentError, TypeError
            nil
          end
        raise ArgumentError, "qos must be 0 or 1" unless value == 0 || value == 1
        value
      end

      def normalize_retain(retain)
        return nil if retain.nil?
        !!retain
      end

      def normalize_properties(properties)
        return nil if properties.nil?

        unless properties.respond_to?(:to_h)
          raise ArgumentError, "properties must be hash-like"
        end

        properties.to_h.each_with_object({}) do |(key, value), acc|
          next if key.nil? || value.nil?
          acc[key.to_s] = value.to_s
        end

      end
    end

    class << self
      def register_binding(identifier)
        RequestContext.register_binding(identifier) do |_context, binding_name|
          Broker.new(binding_name)
        end
      end
    end
  end
end

Hibana::PubSub.register_binding(Hibana::PubSub::DEFAULT_BINDING_PATTERN)
