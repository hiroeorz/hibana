module D1
  class PreparedStatement
    def initialize(binding_name, sql)
      @binding_name = binding_name
      @sql = sql
      @bindings = []
    end

    def bind(*values)
      @bindings = values
      self # メソッドチェーンのためにselfを返す
    end

    def first
      execute("first")
    end

    def all
      execute("all")
    end

    def run
      execute("run")
    end

    private

    def execute(action)
      HostBridge.run_d1_query(@binding_name, @sql, @bindings, action)
    end
  end

  class Database
    def initialize(binding_name)
      @binding_name = binding_name
    end

    def prepare(sql)
      PreparedStatement.new(@binding_name, sql)
    end
  end

  class << self
    def register_binding(identifier)
      RequestContext.register_binding(identifier) do |_context, binding_name|
        Database.new(binding_name)
      end
    end
  end
end
