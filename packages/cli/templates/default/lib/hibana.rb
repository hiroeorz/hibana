# frozen_string_literal: true

module Hibana
  class << self
    def app
      @app ||= Router.new
    end

    def reset!
      @app = Router.new
    end
  end
end

Object.include(Hibana::DSL) if defined?(Hibana::DSL)

begin
  load_features = $LOADED_FEATURES
  load_features << 'hibana.rb' unless load_features.include?('hibana.rb')
  load_features << 'hibana' unless load_features.include?('hibana')
rescue StandardError
  # $LOADED_FEATURES might be frozen or unavailable in restricted environments.
end
