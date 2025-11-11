require "json"
require "minitest/autorun"

require_relative "../src/ruby/app/hibana/host_bridge"
require_relative "../src/ruby/app/hibana/context"
require_relative "../src/ruby/app/hibana/html_rewriter"

class HtmlRewriterSpec < Minitest::Test
  class << self
    attr_accessor :captured_payload
  end

  def setup
    HtmlRewriterSpec.captured_payload = nil
    HostBridge.singleton_class.class_eval do
      define_method(:html_rewriter_transform) do |payload|
        HtmlRewriterSpec.captured_payload = payload
        JSON.generate({
          "ok" => true,
          "body" => "<p>rewritten</p>",
          "status" => 200,
          "headers" => { "content-type" => "text/html" },
        })
      end
    end
  end

  def teardown
    Hibana::HTMLRewriter::HandlerRegistry.clear
  end

  def test_transform_serializes_handlers_and_returns_response
    rewriter = HTMLRewriter.new
    rewriter.on("p") { |element| element.set_inner_content("updated") }

    response = Response.new(body: "<p>hi</p>", status: 200)
    new_response = rewriter.transform(response)

    assert_equal "<p>rewritten</p>", new_response.body
    payload = JSON.parse(HtmlRewriterSpec.captured_payload)
    assert_equal 1, payload["elementHandlers"].size
    handler_config = payload["elementHandlers"].first
    assert_equal "p", handler_config["selector"]
    assert_equal ["element"], handler_config["methods"]
  end

  def test_document_block_defaults_to_document_end
    rewriter = HTMLRewriter.new
    rewriter.on_document { |doc| doc.after("<!-- footer -->") }

    rewriter.transform("<html></html>")

    payload = JSON.parse(HtmlRewriterSpec.captured_payload)
    assert_equal ["end"], payload["documentHandlers"].first["methods"]
  end

  def test_bridge_builds_operations_from_handler
    handler = Class.new do
      attr_reader :calls

      def initialize
        @calls = 0
      end

      def element(element)
        @calls += 1
        element.set_inner_content("changed", html: true)
        element.add_class("processed")
      end
    end.new

    token = nil
    token = Hibana::HTMLRewriter::HandlerRegistry.checkout(handler)
    payload = { "tagName" => "p", "attributes" => [["class", "note"]] }
    result = Hibana::HTMLRewriter::Bridge.handle_event(token, "element", JSON.generate(payload))
    parsed = JSON.parse(result)

    assert_equal 2, parsed["operations"].size
    assert_equal "set_inner_content", parsed["operations"].first["op"]
    assert_equal true, parsed["operations"].first["html"]
  ensure
    Hibana::HTMLRewriter::HandlerRegistry.release(token) if token
  end

  def test_document_end_after_records_append_operation
    event = Hibana::HTMLRewriter::DocumentEndEvent.new
    event.after("footer", html: true)
    event.before("header")

    operations = event.response_payload["operations"]
    assert_equal %w[append prepend], operations.map { |op| op["op"] }
    assert_equal true, operations.first["html"]
  end
end
