# frozen_string_literal: true

require "json"

module Hibana
  module Queues
    DEFAULT_BINDING_PATTERN = /_QUEUE$/.freeze
    JSON_CONTENT_TYPE = "json"
    TEXT_CONTENT_TYPE = "text"
    SUPPORTED_CONTENT_TYPES = {
      "json" => "json",
      "application/json" => "json",
      "text" => "text",
      "text/plain" => "text",
      "bytes" => "bytes",
      "application/octet-stream" => "bytes",
      "v8" => "v8",
    }.freeze

    class Producer
      def initialize(binding_name)
        @binding_name = binding_name.to_s
      end

      def send(body, content_type: nil, delay_seconds: nil, metadata: nil)
        message = normalize_message(
          body,
          content_type: content_type,
          delay_seconds: delay_seconds,
          metadata: metadata,
        )
        options = build_options(message)
        args = [message[:body]]
        args << options unless options.empty?
        HostBridge.call_async(@binding_name, :send, *args)
      end
      alias enqueue send

      def send_batch(messages)
        normalized = Array(messages).map.with_index do |entry, index|
          normalize_batch_entry(entry, index)
        end
        if normalized.empty?
          raise ArgumentError, "messages must include at least one entry"
        end
        HostBridge.call_async(@binding_name, :sendBatch, normalized)
      end
      alias enqueue_batch send_batch
      alias bulk_enqueue send_batch

      private

      def normalize_batch_entry(entry, index)
        if entry.respond_to?(:to_hash)
          data = entry.to_hash
          body = data[:body] || data["body"]
          raise ArgumentError, "messages[#{index}] must include :body" if body.nil?
          normalize_entry_hash(body, data)
        else
          build_batch_payload(
            normalize_message(entry, content_type: nil, delay_seconds: nil, metadata: nil),
          )
        end
      end

      def normalize_entry_hash(body, data)
        message = normalize_message(
          body,
          content_type: fetch_option(data, :content_type, :contentType),
          delay_seconds: fetch_option(data, :delay_seconds, :delaySeconds),
          metadata: data[:metadata] || data["metadata"],
        )
        build_batch_payload(message)
      end

      def normalize_message(body, content_type:, delay_seconds:, metadata:)
        normalized_body, inferred_type = normalize_body(body)
        {
          body: normalized_body,
          content_type: normalize_content_type(content_type, inferred_type),
          delay_seconds: normalize_delay(delay_seconds),
          metadata: normalize_metadata(metadata),
        }
      end

      def normalize_body(body)
        return [JSON.generate(nil), JSON_CONTENT_TYPE] if body.nil?
        case body
        when String
          [body, TEXT_CONTENT_TYPE]
        when Numeric, TrueClass, FalseClass
          [JSON.generate(body), JSON_CONTENT_TYPE]
        when Array
          [JSON.generate(body), JSON_CONTENT_TYPE]
        else
          hash_like = hash_like?(body) ? body.to_h : nil
          if hash_like
            [JSON.generate(hash_like), JSON_CONTENT_TYPE]
          else
            [body.to_s, TEXT_CONTENT_TYPE]
          end
        end
      rescue JSON::GeneratorError => error
        raise ArgumentError, "Failed to serialize queue message: #{error.message}"
      end

      def hash_like?(value)
        value.respond_to?(:to_h)
      end

      def normalize_content_type(content_type, fallback)
        effective = content_type || fallback
        return nil if effective.nil?

        normalized =
          effective
            .to_s
            .strip
            &.downcase

        mapped = SUPPORTED_CONTENT_TYPES[normalized]
        return mapped if mapped

        raise ArgumentError,
          "Unsupported queue content type: #{content_type.inspect || 'nil'} (allowed: #{SUPPORTED_CONTENT_TYPES.keys.join(', ')})"
      end

      def normalize_delay(delay_seconds)
        return nil if delay_seconds.nil?
        value =
          begin
            Integer(delay_seconds)
          rescue ArgumentError, TypeError
            nil
          end
        raise ArgumentError, "delay_seconds must be a non-negative integer" if value.nil? || value.negative?
        value
      end

      def normalize_metadata(metadata)
        return nil if metadata.nil?
        unless metadata.respond_to?(:to_h)
          raise ArgumentError, "metadata must be hash-like"
        end
        source = metadata.to_h
        source.each_with_object({}) do |(key, value), acc|
          next if key.nil? || value.nil?
          acc[key.to_s] = value.to_s
        end
      end

      def build_options(message)
        options = {}
        options[:contentType] = message[:content_type] if message[:content_type]
        options[:delaySeconds] = message[:delay_seconds] if message[:delay_seconds]
        options[:metadata] = message[:metadata] if message[:metadata]
        options
      end

      def build_batch_payload(message)
        payload = { body: message[:body] }
        options = build_options(message)
        payload.merge!(options) unless options.empty?
        payload
      end

      def fetch_option(hash, snake_key, camel_key)
        hash[snake_key] || hash[snake_key.to_s] || hash[camel_key] || hash[camel_key.to_s]
      end
    end

    class << self
      def register(*identifiers)
        Array(identifiers).flatten.compact.each do |identifier|
          RequestContext.register_binding(identifier) do |_context, binding_name|
            Producer.new(binding_name)
          end
        end
      end

      def producer(binding_name)
        Producer.new(binding_name)
      end
    end
  end
end

Hibana::Queues.register(Hibana::Queues::DEFAULT_BINDING_PATTERN)
