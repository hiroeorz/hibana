require "json"
require "base64"
require "time"

module Hibana
  module PubSub
    module Webhook
      class Error < StandardError; end

      class Batch
        attr_reader :messages

        def initialize(messages)
          @messages = messages
        end
      end

      class Message
        attr_reader :topic, :content_type, :payload, :data, :published_at

        def initialize(topic:, content_type:, payload:, data:, published_at:)
          @topic = topic
          @content_type = content_type
          @payload = payload
          @data = data
          @published_at = published_at
        end

        def text
          return nil if payload.nil?

          str = payload.dup
          str.force_encoding("UTF-8")
          str.valid_encoding? ? str : nil
        end

        def json
          raise Error, "payload is empty" if payload.nil? || payload.empty?

          JSON.parse(payload)
        rescue JSON::ParserError => error
          raise Error, "Failed to parse JSON payload: #{error.message}"
        end
      end

      class << self
        def parse(context)
          raise ArgumentError, "context is required" if context.nil?

          payload = parse_json(context.raw_body.to_s)
          messages = normalize_messages(payload)
          Batch.new(messages.map { |entry| build_message(entry) })
        end

        private

        def parse_json(body)
          return {} if body.nil? || body.empty?

          JSON.parse(body)
        rescue JSON::ParserError => error
          raise Error, "Invalid JSON payload: #{error.message}"
        end

        def normalize_messages(payload)
          if payload.is_a?(Hash)
            messages = payload["messages"] || payload[:messages]

            return Array(messages) if messages

            return [payload]
          end

          raise Error, "Pub/Sub webhook payload must be an object"
        end

        def build_message(entry)
          unless entry.is_a?(Hash)
            raise Error, "Each message must be provided as an object"
          end

          topic = string_or_nil(entry[:topic] || entry["topic"])
          content_type = string_or_nil(entry[:contentType] || entry["contentType"] || entry["content_type"])
          raw_data = entry[:data] || entry["data"] || entry[:payload] || entry["payload"]
          base64_flag = truthy?(entry[:base64] || entry["base64"] || entry[:isBase64] || entry["isBase64"] || entry["is_base64"])
          payload = decode_payload(raw_data, base64: base64_flag)
          published_at = parse_time(entry[:publishedAt] || entry["publishedAt"] || entry["published_at"])

          Message.new(
            topic: topic,
            content_type: content_type,
            payload: payload,
            data: raw_data,
            published_at: published_at,
          )
        end

        def decode_payload(raw_data, base64:)
          return nil if raw_data.nil?

          return raw_data.to_s unless base64

          Base64.decode64(raw_data.to_s)
        rescue ArgumentError => error
          raise Error, "Failed to decode base64 payload: #{error.message}"
        end

        def parse_time(value)
          return nil if value.nil?

          Time.parse(value.to_s)
        rescue ArgumentError
          nil
        end

        def string_or_nil(value)
          return nil if value.nil?

          stringified = value.to_s
          stringified.empty? ? nil : stringified
        end

        def truthy?(value)
          return false if value.nil?

          return value if value == true || value == false

          value.to_s.strip.downcase == "true"
        end
      end
    end
  end
end
