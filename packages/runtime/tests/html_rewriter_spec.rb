require "json"
require "minitest/autorun"

require_relative "../src/ruby/app/hibana/host_bridge"
require_relative "../src/ruby/app/hibana/context"
require_relative "../src/ruby/app/hibana/html_rewriter"

class HtmlRewriterSpec < Minitest::Test
  class HostFunctionStub
    def initialize(&block)
      @block = block
    end

    def apply(*args)
      @block.call(*args)
    end
  end

  def setup
    HostBridge.ts_report_ruby_error = HostFunctionStub.new { |_payload| nil }
    @captured_payloads = []
  end

  def test_transform_builds_payload_and_returns_response
    HostBridge.ts_html_rewriter_transform = HostFunctionStub.new do |payload|
      @captured_payloads << JSON.parse(payload)
      JSON.generate({
        ok: true,
        response: {
          body: "<div>rewritten</div>",
          status: 201,
          headers: { "content-type" => "text/html" },
        },
      })
    end

    rewriter = Hibana::HTMLRewriter.new
    rewriter.on("p.highlight") do |element|
      element.set_attribute("data-role", "example")
      element.append("<span>Ruby</span>", html: true)
    end

    response = rewriter.transform("<html><body><p class=\"highlight\"></p></body></html>")

    assert_instance_of Response, response
    assert_equal "<div>rewritten</div>", response.body
    assert_equal 201, response.status
    assert_equal({ "content-type" => "text/html" }, response.headers)

    payload = @captured_payloads.first
    refute_nil payload
    assert_equal "string", payload.fetch("input").fetch("type")
    assert_equal "<html><body><p class=\"highlight\"></p></body></html>", payload.fetch("input").fetch("body")
    handlers = payload.fetch("handlers")
    assert_equal 1, handlers.length
    handler = handlers.first
    assert_equal "selector", handler.fetch("type")
    assert_equal "p.highlight", handler.fetch("selector")
    assert_includes handler.fetch("methods"), "element"
  end

  def test_dispatch_handler_builds_element_commands
    HostBridge.ts_html_rewriter_transform = HostFunctionStub.new { JSON.generate({ ok: true, response: { body: "", status: 200, headers: {} } }) }

    rewriter = Hibana::HTMLRewriter.new
    rewriter.on("p") do |element|
      element.set_attribute("data-test", "value")
      element.append("<span>content</span>", html: true)
      element.remove_class("old")
    end

    handler_entry = rewriter.send(:serialized_handlers).first
    handler_id = handler_entry.fetch("handler_id")

    payload = {
      "tagName" => "p",
      "attributes" => [
        { "name" => "class", "value" => "old" },
      ],
    }

    result_json = Hibana::HTMLRewriter.__dispatch_handler(handler_id, "element", JSON.generate(payload))
    result = JSON.parse(result_json)
    commands = result.fetch("commands")

    assert_equal 3, commands.length
    assert_equal "set_attribute", commands[0].fetch("op")
    assert_equal "data-test", commands[0].fetch("name")
    assert_equal "value", commands[0].fetch("value")
    assert_equal "append", commands[1].fetch("op")
    assert_equal "<span>content</span>", commands[1].fetch("content")
    assert_equal true, commands[1]["html"]
    assert_equal "remove_class", commands[2].fetch("op")
    assert_equal "old", commands[2].fetch("name")
  end

  def test_dispatch_handler_handles_document_commands
    HostBridge.ts_html_rewriter_transform = HostFunctionStub.new { JSON.generate({ ok: true, response: { body: "", status: 200, headers: {} } }) }

    rewriter = Hibana::HTMLRewriter.new
    rewriter.on_document do |document|
      document.append_to_head("<meta charset=\"utf-8\">", html: true)
      document.end
    end

    handler_entry = rewriter.send(:serialized_handlers).find { |entry| entry.fetch("type") == "document" }
    handler_id = handler_entry.fetch("handler_id")

    result_json = Hibana::HTMLRewriter.__dispatch_handler(handler_id, "document", JSON.generate({}))
    result = JSON.parse(result_json)
    commands = result.fetch("commands")

    assert_equal 2, commands.length
    assert_equal "append_to_head", commands[0].fetch("op")
    assert_equal "<meta charset=\"utf-8\">", commands[0].fetch("content")
    assert_equal true, commands[0]["html"]
    assert_equal "end", commands[1].fetch("op")
  end

  def test_transform_raises_on_host_error
    HostBridge.ts_html_rewriter_transform = HostFunctionStub.new do |_payload|
      JSON.generate({ ok: false, error: { message: "rewrite failed" } })
    end

    rewriter = Hibana::HTMLRewriter.new
    rewriter.on("div") { |_element| }

    error = assert_raises(RuntimeError) do
      rewriter.transform("<div></div>")
    end
    assert_includes error.message, "rewrite failed"
  end
end
