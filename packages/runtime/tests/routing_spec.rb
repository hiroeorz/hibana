require "json"
require "minitest/autorun"

require_relative "../src/ruby/app/hibana/context"
require_relative "../src/ruby/app/hibana/static_server"

module HostBridge
  def self.report_ruby_error(_payload); end
end

require_relative "../src/ruby/app/hibana/routing"

class RoutingSpec < Minitest::Test
  def setup
    reset_routes!
  end

  def test_named_params_are_exposed_via_context_params
    get "/posts/:id" do |c|
      c.json(id: c.params[:id], raw: c.path_param("id"))
    end

    response = call_route("GET", "/posts/42")
    body = JSON.parse(response["body"])
    assert_equal({ "id" => "42", "raw" => "42" }, body)
  end

  def test_query_params_merge_with_path_params_path_wins
    get "/items/:id" do |c|
      c.json(c.params)
    end

    response = call_route("GET", "/items/10", query: { "id" => "query", "page" => "1" })
    body = JSON.parse(response["body"])
    assert_equal "10", body["id"]
    assert_equal "1", body["page"]
  end

  def test_splat_captures_remaining_path
    get "/assets/*path" do |c|
      c.text(c.params[:path])
    end

    response = call_route("GET", "/assets/css/site/main.css")
    assert_equal "css/site/main.css", response["body"]
  end

  def test_regex_routes_require_named_captures
    assert_raises(ArgumentError) do
      get(%r{\A/posts/\d+\z}) { |_c| raise "should not register" }
    end
  end

  def test_regex_routes_capture_values
    get(%r{\A/users/(?<id>\d+)\z}) { |c| c.text(c.params["id"]) }

    response = call_route("GET", "/users/77")
    assert_equal "77", response["body"]
  end

  def test_exact_route_wins_over_dynamic
    get "/posts/:id" do |c|
      c.text("dynamic #{c.params[:id]}")
    end
    get "/posts/latest" do |_c|
      Response.new(body: "latest", status: 200)
    end

    response = call_route("GET", "/posts/latest")
    assert_equal "latest", response["body"]
  end

  def test_more_specific_dynamic_route_wins
    get "/files/:name" do |c|
      c.text("single #{c.params[:name]}")
    end
    get "/files/*path" do |c|
      c.text("splat #{c.params[:path]}")
    end

    response = call_route("GET", "/files/readme")
    assert_equal "single readme", response["body"]
  end

  private

  def call_route(method, path, query: nil)
    context = RequestContext.new
    context.set_query_from_json(JSON.generate(query)) if query

    JSON.parse(dispatch(method, path, context))
  end
end
