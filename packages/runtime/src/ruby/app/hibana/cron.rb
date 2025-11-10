# frozen_string_literal: true

require "json"

module Hibana
  class ScheduledEvent
    attr_reader :cron, :scheduled_time, :scheduled_time_ms, :type, :retry_count, :no_retry, :payload

    def initialize(attributes = {})
      attrs = attributes || {}
      @cron = normalize_string(attrs["cron"] || attrs[:cron])
      @scheduled_time_ms = extract_numeric(attrs["scheduled_time"] || attrs["scheduledTime"])
      @scheduled_time = @scheduled_time_ms ? Time.at(@scheduled_time_ms / 1000.0) : nil
      @type = normalize_string(attrs["type"] || attrs[:type] || "scheduled")
      @retry_count = (attrs["retry_count"] || attrs["retryCount"] || 0).to_i
      @no_retry = !!(attrs["no_retry"] || attrs["noRetry"])
      @payload = attrs["payload"] || attrs[:payload]
    end

    private

    def normalize_string(value)
      return "" if value.nil?
      value.to_s
    end

    def extract_numeric(value)
      return nil if value.nil?
      Float(value)
    rescue ArgumentError, TypeError
      nil
    end
  end

  class ScheduledContext < RequestContext
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

  module CronRegistry
    class << self
      def handlers
        @handlers ||= []
      end

      def register(pattern, block)
        handlers << {
          pattern: normalize_pattern(pattern),
          block: block,
        }
      end

      def matching_handlers(cron_expression)
        normalized_expression = cron_expression.to_s
        handlers.select { |entry| match_pattern?(entry[:pattern], normalized_expression) }
      end

      def clear
        handlers.clear
      end

      private

      def normalize_pattern(pattern)
        return :all if pattern.nil? || pattern == "*" || pattern == :all
        unless pattern.is_a?(String)
          raise ArgumentError, "Cron pattern must be provided as a string or '*'"
        end
        normalized = pattern.strip
        raise ArgumentError, "Cron pattern cannot be empty" if normalized.empty?
        normalized
      end

      def match_pattern?(pattern, cron_expression)
        pattern == :all || pattern == cron_expression
      end
    end
  end
end

def cron(pattern = "*", &block)
  raise ArgumentError, "Block is required for cron handler" unless block_given?
  Hibana::CronRegistry.register(pattern, block)
end

def reset_cron_handlers!
  Hibana::CronRegistry.clear
end

def dispatch_scheduled(payload_json)
  payload = parse_payload(payload_json)
  event = Hibana::ScheduledEvent.new(payload)
  handlers = Hibana::CronRegistry.matching_handlers(event.cron)

  if handlers.empty?
    warn "[Hibana][cron] No Ruby handler matched cron '#{event.cron}'. Define cron \"#{event.cron}\" {...} to handle it."
    return JSON.generate({
      "status" => "no_handler",
      "cron" => event.cron,
    })
  end

  handlers.each do |entry|
    context = Hibana::ScheduledContext.new
    entry[:block].call(event, context)
  end

  JSON.generate({
    "status" => "ok",
    "executed" => handlers.length,
  })
rescue => error
  report_cron_dispatch_error(error)
end

def parse_payload(payload_json)
  return {} if payload_json.nil? || payload_json.empty?
  JSON.parse(payload_json)
rescue JSON::ParserError
  {}
end

def report_cron_dispatch_error(error)
  payload = {
    message: error.message,
    class: error.class.name,
    backtrace: error.backtrace,
  }

  begin
    HostBridge.report_ruby_error(JSON.generate(payload))
  rescue => report_error
    warn "Ruby Cron: failed to report error - #{report_error.message}"
  end

  JSON.generate({
    "status" => "error",
    "error" => {
      "message" => error.message,
      "class" => error.class.name,
    },
  })
end
