module R2
  class ObjectWrapper
    def initialize(js_object)
      @js_object = js_object
    end

    def text
      invoke(:text)
    end

    def json
      invoke(:json)
    end

    def method_missing(name, *args, &block)
      raise ArgumentError, "Block is not supported for R2::ObjectWrapper##{name}" if block

      invoke(name, *args)
    end

    def respond_to_missing?(_name, _include_private = false)
      true
    end

    private

    def invoke(name, *args)
      result = @js_object.call(name.to_s, *args)
      if result.respond_to?(:await)
        result.await
      else
        result
      end
    end
  end

  class NullObjectWrapper
    def text
      nil
    end

    def json
      nil
    end

    def method_missing(_name, *_args, &_block)
      nil
    end

    def respond_to_missing?(_name, _include_private = false)
      true
    end
  end

  class Bucket
    def initialize(binding_name)
      @binding_name = binding_name.to_s
    end

    def put(key, value)
      # TypeScript側のR2関数を呼び出し、完了まで待機
      HostBridge.call_async(@binding_name, :put, key, value)
    end

    def get(key)
      js_object = HostBridge.call_async(@binding_name, :get, key)
      return NullObjectWrapper.new if js_object.nil?

      ObjectWrapper.new(js_object)
    end
  end

  class << self
    def register_binding(identifier)
      RequestContext.register_binding(identifier) do |_context, binding_name|
        Bucket.new(binding_name)
      end
    end
  end
end
