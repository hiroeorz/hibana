require "json"

module Hibana
  module HTMLRewriter
    DEFAULT_CONTENT_TYPE = "text/html; charset=UTF-8"

    class Error < StandardError
      attr_reader :details

      def initialize(message, details = {})
        super(message)
        @details = details || {}
      end
    end

    HandlerDescriptor = Struct.new(:selector, :handler, :methods)
    DocumentDescriptor = Struct.new(:handler, :methods)

    class Engine
      def initialize(preserve_content_length: false)
        @preserve_content_length = !!preserve_content_length
        @element_descriptors = []
        @document_descriptors = []
      end

      def on(selector, handler = nil, &block)
        normalized = selector.to_s
        if normalized.empty?
          raise ArgumentError, "selector is required"
        end
        resolved_handler = resolve_element_handler(handler, &block)
        methods = HandlerMethods.determine(resolved_handler, %i[element text comments])
        if methods.empty?
          raise ArgumentError, "HTMLRewriter handler must respond to element/text/comments"
        end
        @element_descriptors << HandlerDescriptor.new(normalized, resolved_handler, methods)
        self
      end

      def on_document(handler = nil, &block)
        resolved_handler = resolve_document_handler(handler, &block)
        methods = HandlerMethods.determine(resolved_handler, %i[text comments doctype document_end])
        if methods.empty?
          raise ArgumentError, "Document handler must respond to text/comments/doctype/document_end"
        end
        @document_descriptors << DocumentDescriptor.new(resolved_handler, methods)
        self
      end

      def transform(target)
        response = normalize_target(target)
        checkout = Checkout.new
        payload = {
          "options" => build_options,
          "elementHandlers" => checkout.prepare_element_handlers(@element_descriptors),
          "documentHandlers" => checkout.prepare_document_handlers(@document_descriptors),
          "response" => serialize_response(response),
        }
        json_result = HostBridge.html_rewriter_transform(JSON.generate(payload))
        parsed = parse_result(json_result)
        Response.new(
          body: parsed["body"],
          status: parsed["status"],
          headers: parsed["headers"] || {},
        )
      rescue JSON::ParserError => e
        raise Error.new("Failed to parse HTMLRewriter response", { cause: e.message })
      ensure
        checkout&.release_all
      end

      private

      def resolve_element_handler(handler, &block)
        if block_given?
          ElementBlockHandler.new(block)
        elsif handler.nil?
          raise ArgumentError, "handler is required"
        else
          handler
        end
      end

      def resolve_document_handler(handler, &block)
        if block_given?
          DocumentBlockHandler.new(block)
        elsif handler.nil?
          raise ArgumentError, "handler is required"
        else
          handler
        end
      end

      def normalize_target(target)
        case target
        when Response
          target
        when Hash
          Response.new(
            body: target[:body] || target["body"],
            status: target[:status] || target["status"] || 200,
            headers: target[:headers] || target["headers"] || {},
          )
        when NilClass
          Response.new(body: "", status: 200, headers: { "content-type" => DEFAULT_CONTENT_TYPE })
        else
          Response.new(body: target.to_s, status: 200, headers: { "content-type" => DEFAULT_CONTENT_TYPE })
        end
      end

      def build_options
        return {} unless @preserve_content_length
        { "preserveContentLength" => true }
      end

      def serialize_response(response)
        {
          "body" => response.body.to_s,
          "status" => response.status.to_i,
          "headers" => response.headers || {},
        }
      end

      def parse_result(json_result)
        string = if json_result.respond_to?(:to_str)
          json_result.to_str
        else
          json_result.to_s
        end
        parsed = JSON.parse(string)
        unless parsed.is_a?(Hash)
          raise Error.new("HTMLRewriter response is malformed", { payload: parsed })
        end
        if parsed["ok"] != true
          details = parsed["error"].is_a?(Hash) ? parsed["error"] : {}
          message = details["message"] || "HTMLRewriter transform failed"
          raise Error.new(message, details)
        end
        parsed
      end
    end

    class Checkout
      def initialize
        @tokens = []
      end

      def prepare_element_handlers(descriptors)
        descriptors.map do |descriptor|
          token = HandlerRegistry.checkout(descriptor.handler)
          @tokens << token
          {
            "selector" => descriptor.selector,
            "handlerId" => token,
            "methods" => descriptor.methods,
          }
        end
      end

      def prepare_document_handlers(descriptors)
        descriptors.map do |descriptor|
          token = HandlerRegistry.checkout(descriptor.handler)
          @tokens << token
          {
            "handlerId" => token,
            "methods" => descriptor.methods,
          }
        end
      end

      def release_all
        @tokens.each { |token| HandlerRegistry.release(token) }
        @tokens.clear
      end
    end

    module HandlerRegistry
      module_function

      def checkout(handler)
        token = next_token
        handlers[token] = handler
        token
      end

      def fetch(token)
        handlers[token]
      end

      def release(token)
        handlers.delete(token)
      end

      def clear
        handlers.clear
      end

      def handlers
        @handlers ||= {}
      end

      def next_token
        @sequence ||= 0
        @sequence += 1
        "html_rewriter_handler_#{@sequence}"
      end
    end

    module HandlerMethods
      module_function

      METHOD_TO_EVENT = {
        element: "element",
        text: "text",
        comments: "comments",
        doctype: "doctype",
        document_end: "end",
        end_tag: "end_tag",
      }.freeze

      def determine(handler, allowed)
        allowed.each_with_object([]) do |method_name, acc|
          next unless handler.respond_to?(method_name)
          event_name = METHOD_TO_EVENT[method_name]
          acc << event_name if event_name
        end
      end
    end

    module Bridge
      module_function

      EVENT_DISPATCH = {
        "element" => :element,
        "text" => :text,
        "comments" => :comments,
        "doctype" => :doctype,
        "end" => :document_end,
        "end_tag" => :end_tag,
      }.freeze

      def handle_event(handler_id, event_type, payload_json)
        handler = HandlerRegistry.fetch(handler_id)
        return JSON.generate("operations" => []) unless handler

        payload = parse_payload(payload_json)
        event = EventFactory.build(event_type, payload)
        dispatch(handler, event_type, event)
        JSON.generate(event.response_payload)
      rescue StandardError => e
        JSON.generate({
          "error" => {
            "message" => e.message,
            "class" => e.class.name,
          },
        })
      end

      def release_handler(handler_id)
        HandlerRegistry.release(handler_id)
        nil
      end

      def parse_payload(json)
        return {} if json.nil? || json.empty?
        JSON.parse(json)
      rescue JSON::ParserError
        {}
      end

      def dispatch(handler, event_type, event)
        method = EVENT_DISPATCH[event_type]
        return unless method && handler.respond_to?(method)
        handler.public_send(method, event)
      end
    end

    module EventFactory
      module_function

      def build(event_type, payload)
        case event_type
        when "element"
          ElementEvent.new(payload)
        when "text"
          TextChunk.new(payload)
        when "comments"
          CommentChunk.new(payload)
        when "doctype"
          DoctypeEvent.new(payload)
        when "end_tag"
          EndTagEvent.new(payload)
        when "end"
          DocumentEndEvent.new
        else
          NullEvent.new
        end
      end
    end

    class OperationRecorder
      def initialize
        @operations = []
      end

      def record(op, data = {})
        payload = { "op" => op }.merge(data.compact)
        @operations << payload
        payload
      end

      def operations
        @operations.dup
      end
    end

    class ElementEvent < OperationRecorder
      attr_reader :tag_name, :namespace_uri

      def initialize(payload)
        super()
        @tag_name = payload["tagName"].to_s
        @namespace_uri = payload["namespaceURI"]
        @removed = payload["removed"] == true
        @attributes = build_attribute_map(payload["attributes"])
      end

      def attributes
        @attributes.map { |key, value| [key.dup, value.dup] }
      end

      def get_attribute(name)
        return nil if name.nil?
        @attributes[name.to_s]
      end

      def has_attribute?(name)
        return false if name.nil?
        @attributes.key?(name.to_s)
      end

      def set_attribute(name, value)
        raise ArgumentError, "name is required" if name.nil? || name.to_s.empty?
        string_name = name.to_s
        string_value = value.to_s
        @attributes[string_name] = string_value
        record("set_attribute", "name" => string_name, "value" => string_value)
      end

      def remove_attribute(name)
        return if name.nil?
        key = name.to_s
        @attributes.delete(key)
        record("remove_attribute", "name" => key)
      end

      def add_class(value)
        return if value.nil?
        record("add_class", "value" => value.to_s)
      end

      def remove_class(value)
        return if value.nil?
        record("remove_class", "value" => value.to_s)
      end

      def set_inner_content(content, html: false)
        record(
          "set_inner_content",
          "content" => content.to_s,
          "html" => !!html,
        )
      end

      def set_outer_content(content, html: false)
        record(
          "set_outer_content",
          "content" => content.to_s,
          "html" => !!html,
        )
      end

      def append(content, html: false)
        record("append", "content" => content.to_s, "html" => !!html)
      end

      def prepend(content, html: false)
        record("prepend", "content" => content.to_s, "html" => !!html)
      end

      def before(content, html: false)
        record("before", "content" => content.to_s, "html" => !!html)
      end

      def after(content, html: false)
        record("after", "content" => content.to_s, "html" => !!html)
      end

      def replace(content, html: false)
        record("replace", "content" => content.to_s, "html" => !!html)
      end

      def remove
        @removed = true
        record("remove")
      end

      def removed?
        @removed
      end

      def on_end_tag(handler = nil, &block)
        resolved = if block_given?
          EndTagBlockHandler.new(block)
        elsif handler.nil?
          raise ArgumentError, "handler or block is required"
        else
          handler
        end
        methods = HandlerMethods.determine(resolved, %i[end_tag])
        if methods.empty?
          raise ArgumentError, "End tag handler must implement #end_tag"
        end
        token = HandlerRegistry.checkout(resolved)
        record("on_end_tag", "handlerId" => token)
      end

      def response_payload
        { "operations" => operations }
      end

      private

      def build_attribute_map(entries)
        Array(entries).each_with_object({}) do |entry, acc|
          name, value = entry
          next if name.nil?
          acc[name.to_s] = value.to_s
        end
      end
    end

    class TextChunk < OperationRecorder
      attr_reader :text

      def initialize(payload)
        super()
        @text = payload["text"].to_s
        @last_in_text_node = payload["lastInTextNode"] == true
      end

      def last_in_text_node?
        @last_in_text_node
      end

      def replace(content, html: false)
        record("replace", "content" => content.to_s, "html" => !!html)
      end

      def before(content, html: false)
        record("before", "content" => content.to_s, "html" => !!html)
      end

      def after(content, html: false)
        record("after", "content" => content.to_s, "html" => !!html)
      end

      def prepend(content, html: false)
        record("prepend", "content" => content.to_s, "html" => !!html)
      end

      def append(content, html: false)
        record("append", "content" => content.to_s, "html" => !!html)
      end

      def remove
        record("remove")
      end

      def response_payload
        { "operations" => operations }
      end
    end

    class CommentChunk < OperationRecorder
      attr_reader :text

      def initialize(payload)
        super()
        @text = payload["text"].to_s
      end

      def replace(content)
        record("replace", "content" => content.to_s)
      end

      def before(content)
        record("before", "content" => content.to_s)
      end

      def after(content)
        record("after", "content" => content.to_s)
      end

      def remove
        record("remove")
      end

      def response_payload
        { "operations" => operations }
      end
    end

    class DoctypeEvent
      attr_reader :name, :public_id, :system_id

      def initialize(payload)
        @name = payload["name"].to_s
        @public_id = payload["publicId"]
        @system_id = payload["systemId"]
      end

      def response_payload
        { "operations" => [] }
      end
    end

    class EndTagEvent < OperationRecorder
      attr_reader :name

      def initialize(payload)
        super()
        @name = payload["name"].to_s
      end

      def before(content, html: false)
        record("before", "content" => content.to_s, "html" => !!html)
      end

      def after(content, html: false)
        record("after", "content" => content.to_s, "html" => !!html)
      end

      def remove
        record("remove")
      end

      def response_payload
        { "operations" => operations }
      end
    end

    class DocumentEndEvent < OperationRecorder
      def append(content, html: false)
        record("append", "content" => content.to_s, "html" => !!html)
      end

      def prepend(content, html: false)
        record("prepend", "content" => content.to_s, "html" => !!html)
      end

      def after(content, html: false)
        append(content, html: html)
      end

      def before(content, html: false)
        prepend(content, html: html)
      end

      def response_payload
        { "operations" => operations }
      end
    end

    class NullEvent
      def response_payload
        { "operations" => [] }
      end
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

      def document_end(event)
        @block.call(event)
      end
    end

    class EndTagBlockHandler
      def initialize(block)
        @block = block
      end

      def end_tag(event)
        @block.call(event)
      end
    end
  end
end

class HTMLRewriter < Hibana::HTMLRewriter::Engine
end
