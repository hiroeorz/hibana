# frozen_string_literal: true

class {{moduleName}}
  def call(_env)
    # TODO: Plug in Hibana's routing DSL once the runtime is ready.
    [200, { 'content-type' => 'text/plain; charset=utf-8' }, ["Hello from Hibana Ruby!\n"]]
  end
end
