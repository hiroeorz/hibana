# frozen_string_literal: true

require "json"
require "time"

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

    class Error < StandardError; end
    class AckError < Error; end

    module Registry
      class << self
        def handlers
          @handlers ||= []
        end

        def register(binding:, queue:, block:)
          handlers << {
            binding: binding,
            queue: queue,
            block: block,
          }
        end

      def handlers_for(binding:, queue:)
        handlers.select do |entry|
          binding_match =
            entry[:binding].nil? ||
            binding.nil? ||
            entry[:binding] == binding
          queue_match =
            entry[:queue].nil? ||
            queue.nil? ||
            entry[:queue] == queue
          binding_match && queue_match
        end
      end

        def clear
          handlers.clear
        end
      end
    end

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

        normalized = effective.to_s.strip.downcase
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

    class Batch
      include Enumerable

      attr_reader :queue, :binding, :handle, :messages

      def initialize(payload, binding_name:)
        @handle = (payload["batchHandle"] || payload["batch_handle"] || "").to_s
        @queue = (payload["queue"] || "").to_s
        @binding = binding_name
        raw_messages = payload["messages"] || []
        @messages = raw_messages.map { |entry| Message.new(entry, batch: self) }
      end

      def each(&block)
        @messages.each(&block)
      end

      def size
        @messages.size
      end

      def ack_all!
        HostBridge.queue_batch_op(handle: handle, op: "ack_all")
        @messages.each(&:mark_handled!)
      rescue => error
        raise AckError, error.message
      end

      def retry_all!(delay_seconds: nil)
        payload = { handle: handle, op: "retry_all" }
        payload[:delaySeconds] = Integer(delay_seconds) if delay_seconds
        HostBridge.queue_batch_op(payload)
        @messages.each(&:mark_handled!)
      rescue ArgumentError
        raise
      rescue => error
        raise AckError, error.message
      end
    end

    class Message
      attr_reader :id, :attempts, :queue, :binding, :handle, :timestamp

      def initialize(payload, batch:)
        @batch = batch
        @handle = (payload["handle"] || "").to_s
        @id = (payload["id"] || "").to_s
        @attempts = (payload["attempts"] || 0).to_i
        timestamp_ms = payload["timestamp"] || payload["timestamp_ms"]
        @timestamp = timestamp_ms ? Time.at(timestamp_ms.to_f / 1000.0) : nil
        @queue = batch.queue
        @binding = batch.binding
        @body_descriptor = payload["body"] || {}
        @handled = false
      end

      def body
        @body ||= decode_body
      end

      def raw_body
        descriptor = @body_descriptor
        case descriptor["format"]
        when "json"
          descriptor["json"]
        when "text"
          descriptor["text"].to_s
        else
          descriptor.to_s
        end
      end

      def ack!
        ensure_active!
        HostBridge.queue_message_op(handle: handle, op: "ack")
        @handled = true
      rescue => error
        raise AckError, error.message
      end

      def retry!(delay_seconds: nil)
        ensure_active!
        payload = { handle: handle, op: "retry" }
        payload[:delaySeconds] = Integer(delay_seconds) if delay_seconds
        HostBridge.queue_message_op(payload)
        @handled = true
      rescue ArgumentError
        raise
      rescue => error
        raise AckError, error.message
      end

      def handled?
        @handled
      end

      def mark_handled!
        @handled = true
      end

      private

      def ensure_active!
        raise AckError, "Message #{id} already settled" if handled?
      end

      def decode_body
        descriptor = @body_descriptor || {}
        case descriptor["format"]
        when "json"
          json = descriptor["json"]
          return JSON.parse(json) unless json.nil? || json.empty?
        when "text"
          return descriptor["text"].to_s
        end
        descriptor
      rescue JSON::ParserError
        descriptor["json"]
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

      def register_handler(binding: nil, queue: nil, &block)
        raise ArgumentError, "Block is required for queue handler" unless block_given?
        Registry.register(
          binding: normalize_binding(binding),
          queue: normalize_queue(queue),
          block: block,
        )
      end

      def dispatch_queue(binding_name, payload_json)
        payload = parse_payload(payload_json)
        binding = normalize_binding(binding_name)
        batch = Batch.new(payload, binding_name: binding)
        handlers = Registry.handlers_for(binding: binding, queue: batch.queue)

        if handlers.empty?
          warn "[Hibana][queue] No Ruby handler matched queue '#{batch.queue}'. Define queue binding: :#{binding || 'QUEUE_NAME'} do ... end to handle it."
          return JSON.generate({
            "status" => "no_handler",
            "queue" => batch.queue,
          })
        end

        handlers.each do |entry|
          context = Hibana::QueueContext.new(
            queue_name: batch.queue,
            binding_name: binding,
          )
          entry[:block].call(batch, context)
        end

        JSON.generate({
          "status" => "ok",
          "handlers" => handlers.length,
        })
      rescue => error
        report_dispatch_error(error)
        JSON.generate({
          "status" => "error",
          "error" => {
            "message" => error.message,
            "class" => error.class.name,
          },
        })
      end

      def clear_handlers!
        Registry.clear
      end

      private

      def parse_payload(payload_json)
        return {} if payload_json.nil? || payload_json.empty?
        JSON.parse(payload_json)
      rescue JSON::ParserError
        {}
      end

      def normalize_binding(value)
        return nil if value.nil?
        stringified = value.is_a?(Symbol) ? value.to_s : value.to_s
        stringified.empty? ? nil : stringified
      end

      def normalize_queue(value)
        return nil if value.nil?
        stringified = value.to_s
        stringified.empty? ? nil : stringified
      end

      def report_dispatch_error(error)
        payload = {
          message: error.message,
          class: error.class.name,
          backtrace: error.backtrace,
        }
        HostBridge.report_ruby_error(JSON.generate(payload))
      rescue => report_error
        warn "[Hibana][queue] Failed to report error: #{report_error.message}"
      end
    end
  end
end

class Hibana::QueueContext < RequestContext
  attr_reader :queue_name, :binding_name

  def initialize(queue_name:, binding_name:)
    super()
    @queue_name = queue_name
    @binding_name = binding_name
  end

  class << self
    def register_binding(identifier, &block)
      RequestContext.register_binding(identifier, &block)
    end

    def binding_factories
      RequestContext.binding_factories
    end

    def binding_matchers
      RequestContext.binding_matchers
    end

    def binding_factory_for(name)
      RequestContext.binding_factory_for(name)
    end
  end
end

def queue(binding: nil, queue: nil, &block)
  Hibana::Queues.register_handler(binding: binding, queue: queue, &block)
end

def reset_queue_handlers!
  Hibana::Queues.clear_handlers!
end

Hibana::Queues.register(Hibana::Queues::DEFAULT_BINDING_PATTERN)
