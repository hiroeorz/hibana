require "json"
require "minitest/autorun"

require_relative "../src/ruby/app/hibana/context"

module HostBridge
  def self.report_ruby_error(_payload); end
end

require_relative "../src/ruby/app/hibana/cron"

class CronSpec < Minitest::Test
  def setup
    reset_cron_handlers!
  end

  def test_exact_match_handler_runs
    executed = []
    cron "0 12 * * *" do |event, ctx|
      executed << [event.cron, ctx.class.name]
    end

    response = dispatch_scheduled(JSON.generate({ "cron" => "0 12 * * *" }))
    payload = JSON.parse(response)

    assert_equal "ok", payload["status"]
    assert_equal 1, payload["executed"]
    assert_equal [["0 12 * * *", "Hibana::ScheduledContext"]], executed
  end

  def test_fallback_handler_executes_after_specific
    executed = []
    cron "0 0 * * *" do |event, _ctx|
      executed << "specific:#{event.cron}"
    end
    cron "*" do |event, _ctx|
      executed << "fallback:#{event.cron}"
    end

    response = dispatch_scheduled(JSON.generate({ "cron" => "0 0 * * *" }))
    payload = JSON.parse(response)

    assert_equal "ok", payload["status"]
    assert_equal ["specific:0 0 * * *", "fallback:0 0 * * *"], executed
  end

  def test_missing_handler_reports_status
    response = dispatch_scheduled(JSON.generate({ "cron" => "15 * * * *" }))
    payload = JSON.parse(response)

    assert_equal "no_handler", payload["status"]
    assert_equal "15 * * * *", payload["cron"]
  end

  def test_handler_error_returns_error_status
    reported = []
    HostBridge.singleton_class.define_method(:report_ruby_error) do |payload|
      reported << JSON.parse(payload)
    end

    cron "0 1 * * *" do |_event, _ctx|
      raise "boom"
    end

    response = dispatch_scheduled(JSON.generate({ "cron" => "0 1 * * *" }))
    payload = JSON.parse(response)

    assert_equal "error", payload["status"]
    refute_empty reported
    assert_equal "boom", reported.first["message"]
  ensure
    HostBridge.singleton_class.define_method(:report_ruby_error) { |_payload| }
  end
end
