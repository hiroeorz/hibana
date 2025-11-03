module KV
  class Namespace
    def initialize(binding_name)
      @binding_name = binding_name.to_s
    end

    def put(key, value)
      HostBridge.call_async(@binding_name, :put, key, value)
    end

    def get(key)
      HostBridge.call_async(@binding_name, :get, key)
    end

    def delete(key)
      HostBridge.call_async(@binding_name, :delete, key)
    end

    def list
      HostBridge.call_async(@binding_name, :list)
    end
  end

  class << self
    def register_binding(identifier)
      RequestContext.register_binding(identifier) do |_context, binding_name|
        Namespace.new(binding_name)
      end
    end
  end
end
