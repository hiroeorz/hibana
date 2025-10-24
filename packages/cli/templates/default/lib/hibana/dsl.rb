# frozen_string_literal: true

module Hibana
  module DSL
    def hibana
      Hibana.app
    end

    Hibana::Router::SUPPORTED_METHODS.each do |verb|
      define_method(verb.downcase) do |path, &block|
        Hibana.app.public_send(verb.downcase, path, &block)
      end
    end
  end
end
