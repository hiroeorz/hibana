require "json"

module Hibana
  class HTMLRewriter
    HANDLER_METHODS = %i[element text comments doctype end document].freeze

    class << self
      def register_handler(handler)
        handler_id = next_handler_id
        handler_registry[handler_id] = handler
        handler_id
      end

      def handler_methods(handler)
        return [] unless handler

        HANDLER_METHODS.select { |method| handler.respond_to?(method) }
      end

      def __dispatch_handler(handler_id, event_type, payload_json)
        handler = handler_registry[handler_id.to_s]
        return JSON.generate({ commands: [] }) unless handler

        payload = parse_payload(payload_json)
        commands = case event_type.to_s
        when "element"
          invoke_element(handler, payload)
        when "text"
          invoke_text(handler, payload)
        when "comments"
          invoke_comment(handler, payload)
        when "doctype"
          invoke_doctype(handler, payload)
        when "end"
          invoke_end(handler, payload)
        when "document"
          invoke_document(handler, payload)
        else
          []
        end

        JSON.generate({ commands: commands })
      rescue StandardError => error
        report_error(error)
        JSON.generate({
          commands: [],
          error: {
            class: error.class.name,
            message: error.message.to_s,
          },
        })
      end

      private

      def handler_registry
        @handler_registry ||= {}
      end

      def next_handler_id
        @handler_sequence ||= 0
        @handler_sequence += 1
        "handler_#{@handler_sequence}"
      end

      def parse_payload(json)
        return {} if json.nil? || json.to_s.empty?

        JSON.parse(json)
      rescue JSON::ParserError
        {}
      end

      def invoke_element(handler, payload)
        return [] unless handler.respond_to?(:element)

        element = Element.new(payload)
        handler.public_send(:element, element)
        element.commands
      end

      def invoke_text(handler, payload)
        return [] unless handler.respond_to?(:text)

        chunk = TextChunk.new(payload)
        handler.public_send(:text, chunk)
        chunk.commands
      end

      def invoke_comment(handler, payload)
        return [] unless handler.respond_to?(:comments)

        comment = Comment.new(payload)
        handler.public_send(:comments, comment)
        comment.commands
      end

      def invoke_doctype(handler, payload)
        return [] unless handler.respond_to?(:doctype)

        doctype = Doctype.new(payload)
        handler.public_send(:doctype, doctype)
        doctype.commands
      end

      def invoke_end(handler, payload)
        return [] unless handler.respond_to?(:end)

        end_tag = EndTag.new(payload)
        handler.public_send(:end, end_tag)
        end_tag.commands
      end

      def invoke_document(handler, payload)
        return [] unless handler.respond_to?(:document)

        document = Document.new
        handler.public_send(:document, document)
        document.commands
      end

      def report_error(error)
        return unless error

        payload = {
          message: error.message.to_s,
          class: error.class.name,
          backtrace: error.backtrace,
        }
        HostBridge.report_ruby_error(JSON.generate(payload))
      rescue StandardError
        # Best-effort only
      end
    end

    def initialize
      @handlers = []
    end

    def on(selector, handler = nil, &block)
      raise ArgumentError, "selector is required" if selector.nil? || selector.to_s.empty?

      final_handler = resolve_handler(handler, block, ElementBlockHandler)
      handler_id = self.class.register_handler(final_handler)
      @handlers << {
        type: :selector,
        selector: selector.to_s,
        handler_id: handler_id,
        methods: self.class.handler_methods(final_handler),
      }
      self
    end

    def on_document(handler = nil, &block)
      final_handler = resolve_handler(handler, block, DocumentBlockHandler)
      handler_id = self.class.register_handler(final_handler)
      @handlers << {
        type: :document,
        handler_id: handler_id,
        methods: self.class.handler_methods(final_handler),
      }
      self
    end

    def transform(input)
      payload = {
        "handlers" => serialized_handlers,
        "input" => serialize_input(input),
      }
      response_payload = perform_transform(payload)
      Response.new(
        body: response_payload.fetch("body", ""),
        status: response_payload.fetch("status", 200),
        headers: stringify_hash(response_payload["headers"]),
      )
    end

    private

    def serialized_handlers
      @handlers.map { |definition| serialize_handler(definition) }
    end

    def serialize_handler(definition)
      {
        "type" => definition[:type].to_s,
        "selector" => definition[:selector],
        "handler_id" => definition[:handler_id],
        "methods" => Array(definition[:methods]).map(&:to_s),
      }.compact
    end

    def serialize_input(input)
      case input
      when Response
        serialize_response_payload(input.payload)
      else
        if input.respond_to?(:payload)
          payload = input.payload
          if payload.is_a?(Hash)
            serialize_response_payload(payload)
          else
            serialize_string_payload(input.to_s)
          end
        elsif input.respond_to?(:to_str)
          serialize_string_payload(input.to_str)
        else
          serialize_string_payload(input.to_s)
        end
      end
    end

    def serialize_response_payload(payload)
      {
        "type" => "response",
        "body" => safe_body(payload["body"]),
        "status" => safe_status(payload["status"]),
        "headers" => stringify_hash(payload["headers"]),
      }
    end

    def serialize_string_payload(value)
      {
        "type" => "string",
        "body" => value.nil? ? "" : value.to_s,
      }
    end

    def safe_body(body)
      body.nil? ? "" : body.to_s
    end

    def safe_status(status)
      status.nil? ? 200 : status.to_i
    end

    def stringify_hash(value)
      return {} unless value.is_a?(Hash)

      value.each_with_object({}) do |(key, val), acc|
        next if key.nil? || val.nil?

        acc[key.to_s] = val.to_s
      end
    end

    def perform_transform(payload)
      payload_json = JSON.generate(payload)
      result = HostBridge.html_rewriter_transform(payload_json)
      result_json = result.respond_to?(:to_str) ? result.to_str : result.to_s
      parsed = JSON.parse(result_json)
      unless parsed.is_a?(Hash) && parsed["ok"]
        error_info = parsed.is_a?(Hash) ? parsed["error"] : nil
        message = if error_info.is_a?(Hash) && error_info["message"]
          error_info["message"].to_s
        else
          "HTMLRewriter transform failed"
        end
        raise RuntimeError, message
      end

      response_payload = parsed["response"]
      unless response_payload.is_a?(Hash)
        raise RuntimeError, "HTMLRewriter transform response payload is malformed"
      end

      response_payload
    rescue JSON::ParserError => error
      raise RuntimeError, "Failed to parse HTMLRewriter transform result: #{error.message}"
    end

    def resolve_handler(handler, block, wrapper_class)
      if handler && block
        raise ArgumentError, "Provide either a handler object or a block"
      end

      return handler if handler
      return wrapper_class.new(block) if block

      raise ArgumentError, "Handler is required"
    end

    class ElementBlockHandler
      def initialize(block)
        @block = block
      end

      def element(element)
        @block.call(element)
      end
    end

    class DocumentBlockHandler
      def initialize(block)
        @block = block
      end

      def document(document)
        @block.call(document)
      end
    end

    class Element
      attr_reader :tag_name, :namespace

      def initialize(payload)
        payload = payload.is_a?(Hash) ? payload : {}
        @tag_name = (payload["tag_name"] || payload["tagName"] || "").to_s
        @namespace = payload["namespace"] || payload["namespaceURI"]
        @attributes = extract_attributes(payload["attributes"])
        @commands = []
      end

      def attributes
        @attributes.dup
      end

      def get_attribute(name)
        @attributes[name.to_s]
      end

      def has_attribute?(name)
        @attributes.key?(name.to_s)
      end

      def set_attribute(name, value)
        record(:set_attribute, name: name, value: value)
      end

      def remove_attribute(name)
        record(:remove_attribute, name: name)
      end

      def set_inner_content(content, html: false)
        record_with_content(:set_inner_content, content, html: html)
      end

      def set_outer_content(content, html: false)
        record_with_content(:set_outer_content, content, html: html)
      end

      def append(content, html: false)
        record_with_content(:append, content, html: html)
      end

      def prepend(content, html: false)
        record_with_content(:prepend, content, html: html)
      end

      def before(content, html: false)
        record_with_content(:before, content, html: html)
      end

      def after(content, html: false)
        record_with_content(:after, content, html: html)
      end

      def replace(content, html: false)
        record_with_content(:replace, content, html: html)
      end

      def remove
        record(:remove)
      end

      def remove_and_keep_content
        record(:remove_and_keep_content)
      end

      def add_class(name)
        record(:add_class, name: name)
      end

      def remove_class(name)
        record(:remove_class, name: name)
      end

      def toggle_class(name, force = nil)
        details = { name: name }
        details[:force] = !!force unless force.nil?
        record(:toggle_class, details)
      end

      def commands
        @commands.map(&:dup)
      end

      private

      def extract_attributes(attributes)
        return {} unless attributes.respond_to?(:each)

        attributes.each_with_object({}) do |attribute, acc|
          name = attribute.is_a?(Hash) ? attribute["name"] || attribute[:name] : nil
          next unless name

          value = if attribute.is_a?(Hash)
            attribute["value"] || attribute[:value]
          elsif attribute.respond_to?(:value)
            attribute.value
          end
          acc[name.to_s] = value.nil? ? nil : value.to_s
        end
      end

      def record(operation, details = {})
        command = { "op" => operation.to_s }
        details.each do |key, value|
          next if value.nil?

          normalized = normalize_command_value(value)
          next if normalized.nil?

          command[key.to_s] = normalized
        end
        @commands << command
        self
      end

      def record_with_content(operation, content, html: false)
        details = { content: content.nil? ? "" : content.to_s }
        details[:html] = true if html
        record(operation, details)
      end

      def normalize_command_value(value)
        case value
        when true, false
          value
        else
          value.to_s
        end
      end
    end

    class TextChunk
      attr_reader :text

      def initialize(payload)
        payload = payload.is_a?(Hash) ? payload : {}
        @text = (payload["text"] || "").to_s
        @last_in_text_node = truthy?(payload["lastInTextNode"]) || truthy?(payload["last_in_text_node"])
        @commands = []
      end

      def last?
        @last_in_text_node
      end

      def replace(content, html: false)
        record_with_content(:replace, content, html: html)
      end

      def before(content, html: false)
        record_with_content(:before, content, html: html)
      end

      def after(content, html: false)
        record_with_content(:after, content, html: html)
      end

      def remove
        record(:remove)
      end

      def commands
        @commands.map(&:dup)
      end

      private

      def record(operation, details = {})
        command = { "op" => operation.to_s }
        details.each do |key, value|
          next if value.nil?

          normalized = normalize_command_value(value)
          next if normalized.nil?

          command[key.to_s] = normalized
        end
        @commands << command
        self
      end

      def record_with_content(operation, content, html: false)
        details = { content: content.nil? ? "" : content.to_s }
        details[:html] = true if html
        record(operation, details)
      end

      def truthy?(value)
        value == true
      end

      def normalize_command_value(value)
        case value
        when true, false
          value
        else
          value.to_s
        end
      end
    end

    class Comment
      attr_reader :text

      def initialize(payload)
        payload = payload.is_a?(Hash) ? payload : {}
        @text = (payload["text"] || "").to_s
        @commands = []
      end

      def replace(content, html: false)
        record_with_content(:replace, content, html: html)
      end

      def before(content, html: false)
        record_with_content(:before, content, html: html)
      end

      def after(content, html: false)
        record_with_content(:after, content, html: html)
      end

      def remove
        record(:remove)
      end

      def commands
        @commands.map(&:dup)
      end

      private

      def record(operation, details = {})
        command = { "op" => operation.to_s }
        details.each do |key, value|
          next if value.nil?

          normalized = normalize_command_value(value)
          next if normalized.nil?

          command[key.to_s] = normalized
        end
        @commands << command
        self
      end

      def record_with_content(operation, content, html: false)
        details = { content: content.nil? ? "" : content.to_s }
        details[:html] = true if html
        record(operation, details)
      end

      def normalize_command_value(value)
        case value
        when true, false
          value
        else
          value.to_s
        end
      end
    end

    class Doctype
      attr_reader :name, :public_id, :system_id

      def initialize(payload)
        payload = payload.is_a?(Hash) ? payload : {}
        @name = (payload["name"] || "").to_s
        @public_id = payload["public_id"] || payload["publicId"]
        @system_id = payload["system_id"] || payload["systemId"]
        @commands = []
      end

      def remove
        record(:remove)
      end

      def before(content, html: false)
        record_with_content(:before, content, html: html)
      end

      def after(content, html: false)
        record_with_content(:after, content, html: html)
      end

      def replace(content, html: false)
        record_with_content(:replace, content, html: html)
      end

      def commands
        @commands.map(&:dup)
      end

      private

      def record(operation, details = {})
        command = { "op" => operation.to_s }
        details.each do |key, value|
          next if value.nil?

          normalized = normalize_command_value(value)
          next if normalized.nil?

          command[key.to_s] = normalized
        end
        @commands << command
        self
      end

      def record_with_content(operation, content, html: false)
        details = { content: content.nil? ? "" : content.to_s }
        details[:html] = true if html
        record(operation, details)
      end

      def normalize_command_value(value)
        case value
        when true, false
          value
        else
          value.to_s
        end
      end
    end

    class Document
      def initialize
        @commands = []
      end

      def append(content, html: false)
        record_with_content(:append, content, html: html)
      end

      def prepend(content, html: false)
        record_with_content(:prepend, content, html: html)
      end

      def append_to_head(content, html: false)
        record_with_content(:append_to_head, content, html: html)
      end

      def append_to_body(content, html: false)
        record_with_content(:append_to_body, content, html: html)
      end

      def prepend_to_head(content, html: false)
        record_with_content(:prepend_to_head, content, html: html)
      end

      def prepend_to_body(content, html: false)
        record_with_content(:prepend_to_body, content, html: html)
      end

      def replace(content, html: false)
        record_with_content(:replace, content, html: html)
      end

      def before(content, html: false)
        record_with_content(:before, content, html: html)
      end

      def after(content, html: false)
        record_with_content(:after, content, html: html)
      end

      def finish
        record(:end)
      end

      alias_method :end, :finish

      def commands
        @commands.map(&:dup)
      end

      private

      def record(operation, details = {})
        command = { "op" => operation.to_s }
        details.each do |key, value|
          next if value.nil?

          normalized = normalize_command_value(value)
          next if normalized.nil?

          command[key.to_s] = normalized
        end
        @commands << command
        self
      end

      def record_with_content(operation, content, html: false)
        details = { content: content.nil? ? "" : content.to_s }
        details[:html] = true if html
        record(operation, details)
      end

      def normalize_command_value(value)
        case value
        when true, false
          value
        else
          value.to_s
        end
      end
    end

    class EndTag
      attr_reader :name

      def initialize(payload)
        payload = payload.is_a?(Hash) ? payload : {}
        @name = (payload["name"] || "").to_s
        @commands = []
      end

      def before(content, html: false)
        record_with_content(:before, content, html: html)
      end

      def after(content, html: false)
        record_with_content(:after, content, html: html)
      end

      def replace(content, html: false)
        record_with_content(:replace, content, html: html)
      end

      def remove
        record(:remove)
      end

      def commands
        @commands.map(&:dup)
      end

      private

      def record(operation, details = {})
        command = { "op" => operation.to_s }
        details.each do |key, value|
          next if value.nil?

          normalized = normalize_command_value(value)
          next if normalized.nil?

          command[key.to_s] = normalized
        end
        @commands << command
        self
      end

      def record_with_content(operation, content, html: false)
        details = { content: content.nil? ? "" : content.to_s }
        details[:html] = true if html
        record(operation, details)
      end

      def normalize_command_value(value)
        case value
        when true, false
          value
        else
          value.to_s
        end
      end
    end
  end
end
