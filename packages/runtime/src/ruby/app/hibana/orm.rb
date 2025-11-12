# frozen_string_literal: true

require "json"
require "time"

module Hibana
  module ORM
    class Error < StandardError; end
    class RecordNotFound < Error; end
    class DatabaseError < Error; end
    class InvalidQuery < Error; end
  end

  module RecordConfig
    class << self
      attr_accessor :default_connection_name
    end
  end
end

Hibana::RecordConfig.default_connection_name = "DB"

module Hibana
  class DatabaseRegistry
    class << self
      def connection(name = nil)
        key = (name || RecordConfig.default_connection_name).to_s
        connections[key] ||= Connection.new(key)
      end

      def reset!
        connections.clear
      end

      private

      def connections
        @connections ||= {}
      end
    end
  end

  class Connection
    def initialize(binding_name)
      @binding_name = binding_name.to_s
    end

    def select_all(sql, bindings = [])
      ensure_sql!(sql)
      Array(execute(sql, bindings, :all))
    end

    def select_one(sql, bindings = [])
      ensure_sql!(sql)
      execute(sql, bindings, :first)
    end

    def run(sql, bindings = [])
      ensure_sql!(sql)
      execute(sql, bindings, :run)
    end

    private

    def ensure_sql!(sql)
      unless sql.is_a?(String) && !sql.strip.empty?
        raise ORM::InvalidQuery, "SQLは文字列で指定してください"
      end
    end

    def execute(sql, bindings, action)
      payload = HostBridge.run_d1_query(@binding_name, sql, bindings || [], map_action(action))
      parsed = parse_payload(payload)
      if parsed.is_a?(Hash) && parsed.key?("error")
        raise ORM::DatabaseError, parsed["error"].to_s
      end
      parsed
    end

    def map_action(action)
      case action
      when :all
        "all"
      when :first
        "first"
      when :run
        "run"
      else
        raise ORM::InvalidQuery, "未対応のD1アクション: #{action}"
      end
    end

    def parse_payload(payload)
      return payload unless payload.is_a?(String)
      return nil if payload.empty?
      JSON.parse(payload)
    rescue JSON::ParserError
      payload
    end
  end
end

module Hibana
  class Relation
    include Enumerable

    attr_reader :model
    attr_accessor :select_values, :where_values, :order_values, :limit_value, :offset_value

    def initialize(model, clauses = {})
      @model = model
      @select_values = clauses[:select_values]&.dup || ["*"]
      @where_values = clone_where_clauses(clauses[:where_values])
      @order_values = clauses[:order_values]&.dup || []
      @limit_value = clauses[:limit_value]
      @offset_value = clauses[:offset_value]
      @records = nil
      @loaded = false
    end

    def select(*columns)
      values = columns.flatten.compact
      return self if values.empty?
      relation = spawn
      relation.select_values = values.map { |value| column_to_sql(value) }
      relation
    end

    def where(conditions = nil, *bindings)
      raise ORM::InvalidQuery, "where条件を指定してください" if conditions.nil?
      relation = spawn

      case conditions
      when String
        relation.where_values << {
          sql: conditions,
          bindings: bindings.flatten,
        }
      when Hash
        relation.where_values.concat(build_hash_conditions(conditions))
      else
        raise ORM::InvalidQuery, "whereには文字列またはハッシュを指定してください"
      end

      relation
    end

    def order(*clauses)
      list = clauses.flatten.compact
      return self if list.empty?
      relation = spawn
      relation.order_values += build_order_clauses(list)
      relation
    end

    def limit(value)
      return self if value.nil?
      numeric = Integer(value)
      relation = spawn
      relation.limit_value = numeric
      relation
    rescue ArgumentError
      raise ORM::InvalidQuery, "limitには数値を指定してください"
    end

    def offset(value)
      return self if value.nil?
      numeric = Integer(value)
      relation = spawn
      relation.offset_value = numeric
      relation
    rescue ArgumentError
      raise ORM::InvalidQuery, "offsetには数値を指定してください"
    end

    def each(&block)
      load.each(&block)
    end

    def first
      limit(1).load.first
    end

    def last
      order(model.primary_key => :desc).limit(1).load.first
    end

    def count
      sql = to_sql(
        select_override: "COUNT(*) AS count",
        include_order: false,
        include_limit: false,
        include_offset: false,
      )
      row = connection.select_one(sql, bind_values)
      extract_row_value(row, "count").to_i
    end

    def exists?
      limit(1).load.any?
    end

    def pluck(*columns)
      names = columns.flatten
      raise ArgumentError, "列名を指定してください" if names.empty?
      map do |record|
        values = names.map { |column| record.public_send(column) }
        names.length == 1 ? values.first : values
      end
    end

    def delete_all
      sql = build_delete_sql
      connection.run(sql, bind_values)
    end

    def none
      where("1 = 0")
    end

    def to_a
      load.dup
    end

    def to_sql(options = {})
      select_clause = options[:select_override] || select_sql
      sql = +"SELECT #{select_clause} FROM #{model.table_name}"
      if (where_sql = where_clause)
        sql << " WHERE #{where_sql}"
      end
      if options.fetch(:include_order, true) && order_values.any?
        sql << " ORDER BY #{order_values.join(', ')}"
      end
      if options.fetch(:include_limit, true) && limit_value
        sql << " LIMIT #{limit_value}"
      end
      if options.fetch(:include_offset, true) && offset_value
        sql << " OFFSET #{offset_value}"
      end
      sql
    end

    protected

    def spawn
      self.class.new(
        model,
        select_values: select_values,
        where_values: where_values,
        order_values: order_values,
        limit_value: limit_value,
        offset_value: offset_value,
      )
    end

    def connection
      model.connection
    end

    def load
      return @records if @loaded
      rows = connection.select_all(to_sql, bind_values)
      @records = Array(rows).map { |row| model.instantiate_from_row(row) }
      @loaded = true
      @records
    end

    private

    def bind_values
      where_values.flat_map { |entry| Array(entry[:bindings]) }
    end

    def build_delete_sql
      sql = +"DELETE FROM #{model.table_name}"
      if (where_sql = where_clause)
        sql << " WHERE #{where_sql}"
      end
      sql
    end

    def column_to_sql(value)
      value.is_a?(Symbol) ? value.to_s : value.to_s
    end

    def build_hash_conditions(hash)
      hash.each_with_object([]) do |(column, value), acc|
        column_name = column_to_sql(column)
        if value.nil?
          acc << { sql: "#{column_name} IS NULL", bindings: [] }
        elsif value.is_a?(Array)
          raise ORM::InvalidQuery, "IN 条件の配列が空です" if value.empty?
          placeholders = Array.new(value.length, "?").join(", ")
          acc << { sql: "#{column_name} IN (#{placeholders})", bindings: value }
        else
          acc << { sql: "#{column_name} = ?", bindings: [value] }
        end
      end
    end

    def build_order_clauses(values)
      values.flat_map do |value|
        case value
        when String
          value
        when Symbol
          value.to_s
        when Hash
          value.map do |column, direction|
            dir = direction ? direction.to_s.upcase : "ASC"
            "#{column_to_sql(column)} #{dir}"
          end
        else
          raise ORM::InvalidQuery, "orderには文字列/シンボル/ハッシュを指定してください"
        end
      end
    end

    def build_clause_sql(entries, joiner)
      return nil if entries.empty?
      entries.map { |entry| "(#{entry[:sql]})" }.join(" #{joiner} ")
    end

    def where_clause
      build_clause_sql(where_values, "AND")
    end

    def select_sql
      values = select_values.compact
      values = ["*"] if values.empty?
      values.join(", ")
    end

    def clone_where_clauses(entries)
      return [] unless entries
      entries.map do |entry|
        {
          sql: entry[:sql],
          bindings: Array(entry[:bindings]).dup,
        }
      end
    end

    def extract_row_value(row, key)
      return 0 if row.nil?
      if row.is_a?(Hash)
        return row[key] if row.key?(key)
        symbol_key = key.to_sym
        return row[symbol_key] if row.key?(symbol_key)
      end
      row.respond_to?(:to_i) ? row.to_i : 0
    end
  end
end

module Hibana
  class Record
    class << self
      def inherited(subclass)
        super
        subclass.instance_variable_set(:@_attribute_definitions, attribute_definitions.transform_values(&:dup))
        subclass.instance_variable_set(:@_table_name, nil)
        subclass.instance_variable_set(:@_primary_key, primary_key)
        subclass.instance_variable_set(:@_connection_name, @_connection_name)
        subclass.instance_variable_set(:@_timestamps, timestamps?)
      end

      def table_name(value = nil)
        if value
          @_table_name = value.to_s
        else
          @_table_name ||= default_table_name
        end
      end

      def primary_key(value = nil)
        if value
          @_primary_key = value.to_s
        else
          @_primary_key ||= "id"
        end
      end

      def timestamps(value = nil)
        if value.nil?
          @_timestamps == true
        else
          @_timestamps = !!value
        end
      end

      def timestamps?
        @_timestamps == true
      end

      def attribute(name, _type = nil, default: nil)
        raise ArgumentError, "attribute名は必須です" if name.nil?
        attribute_definitions[name.to_s] = {
          name: name.to_s,
          default: default,
        }
        define_attribute_reader(name)
        define_attribute_writer(name)
      end

      def attribute_definitions
        @_attribute_definitions ||= {}
      end

      def connection_name(value = nil)
        if value.nil?
          @_connection_name || RecordConfig.default_connection_name
        else
          @_connection_name = value.to_s
        end
      end

      def connection
        DatabaseRegistry.connection(connection_name)
      end

      def relation
        Relation.new(self)
      end

      def all
        relation
      end

      def select(*args)
        relation.select(*args)
      end

      def where(*args)
        relation.where(*args)
      end

      def order(*args)
        relation.order(*args)
      end

      def limit(value)
        relation.limit(value)
      end

      def offset(value)
        relation.offset(value)
      end

      def none
        relation.none
      end

      def find(id)
        record = where(primary_key => id).limit(1).first
        raise ORM::RecordNotFound, "#{name} with #{primary_key}=#{id} was not found" unless record
        record
      end

      def find_by(**attrs)
        where(attrs).limit(1).first
      end

      def create(attrs = {})
        record = new(attrs)
        record.save
        record
      end

      def create!(attrs = {})
        record = new(attrs)
        record.save!
        record
      end

      def update(id, attrs = {})
        record = find(id)
        record.update(attrs)
        record
      end

      def update!(id, attrs = {})
        record = find(id)
        record.update!(attrs)
        record
      end

      def delete(id)
        where(primary_key => id).delete_all
      end

      def scope(name, body = nil, &block)
        callable = body || block
        raise ArgumentError, "scopeにはProcを指定してください" unless callable
        define_singleton_method(name) do |*args|
          result = instance_exec(*args, &callable)
          case result
          when Relation
            result
          when Hash
            relation.where(result)
          when NilClass
            relation
          else
            raise ORM::InvalidQuery, "scopeはRelationまたはHashを返す必要があります"
          end
        end
      end

      def belongs_to(name, foreign_key: nil, class_name: nil, primary_key: nil)
        fk = (foreign_key || "#{name}_id").to_s
        target_class_name = class_name || classify(name.to_s)
        pk_option = primary_key
        define_method(name) do
          foreign_id = read_attribute(fk)
          return nil if foreign_id.nil?
          target_class = self.class.resolve_model_class(target_class_name)
          pk_name = (pk_option || target_class.primary_key).to_s
          target_class.where(pk_name => foreign_id).limit(1).first
        end

        define_method("#{name}=") do |value|
          resolved =
            if value.nil?
              nil
            elsif value.is_a?(Hibana::Record)
              target_pk = (pk_option || value.class.primary_key).to_s
              value.read_attribute(target_pk)
            else
              value
            end
          write_attribute(fk, resolved)
        end
      end

      def has_many(name, foreign_key: nil, class_name: nil, primary_key: nil)
        fk_name = (foreign_key || inferred_foreign_key).to_s
        target_class_name = class_name || classify(singularize(name.to_s))
        owner_pk = (primary_key || self.primary_key).to_s
        define_method(name) do
          owner_id = read_attribute(owner_pk)
          target_class = self.class.resolve_model_class(target_class_name)
          return target_class.none if owner_id.nil?
          target_class.where(fk_name => owner_id)
        end
      end

      def method_missing(method_name, *args, &block)
        if relation.respond_to?(method_name)
          return relation.public_send(method_name, *args, &block)
        end
        super
      end

      def respond_to_missing?(method_name, include_private = false)
        relation.respond_to?(method_name, include_private) || super
      end

      def instantiate_from_row(row)
        record = allocate
        record.send(:initialize_from_database, row || {})
        record
      end

      def resolve_model_class(target)
        return target if target.is_a?(Class) && target <= Hibana::Record
        Object.const_get(target.to_s)
      rescue NameError => e
        raise ORM::InvalidQuery, "関連先クラス '#{target}' を解決できません: #{e.message}"
      end

      private

      def default_table_name
        return "records" unless name
        base = name.split("::").last
        "#{underscore(base)}s"
      end

      def inferred_foreign_key
        "#{underscore(local_class_name)}_id"
      end

      def local_class_name
        (name || "record").split("::").last
      end

      def classify(value)
        value.to_s.split("_").map { |part| part.capitalize }.join
      end

      def singularize(value)
        value.sub(/s\z/, "")
      end

      def underscore(value)
        value.gsub(/([a-z\d])([A-Z])/, '\1_\2').tr("-", "_").downcase
      end

      def define_attribute_reader(name)
        define_method(name) do
          read_attribute(name)
        end
      end

      def define_attribute_writer(name)
        define_method("#{name}=") do |value|
          write_attribute(name, value)
        end
      end
    end

    def initialize(attrs = {})
      @attributes = {}
      @new_record = true
      @destroyed = false
      apply_default_attributes
      assign_attributes(attrs || {})
    end

    def attributes
      @attributes.dup
    end

    def [](name)
      read_attribute(name)
    end

    def []=(name, value)
      write_attribute(name, value)
    end

    def assign_attributes(values)
      return if values.nil?
      unless values.respond_to?(:each_pair)
        raise ArgumentError, "assign_attributesにはハッシュを指定してください"
      end
      values.each_pair do |key, value|
        attribute_name = key.to_s
        unless permitted_attribute?(attribute_name)
          raise ORM::InvalidQuery, "Unknown attribute '#{attribute_name}' is not assignable"
        end
        write_attribute(attribute_name, value)
      end
    end

    def new_record?
      @new_record
    end

    def persisted?
      !new_record? && !destroyed?
    end

    def destroyed?
      @destroyed == true
    end

    def primary_key_value
      read_attribute(self.class.primary_key)
    end

    def save
      persisted = new_record? ? insert_record : update_record
      persisted ? true : false
    end

    def save!
      save || raise(ORM::DatabaseError, "レコードの保存に失敗しました")
    end

    def update(attrs = {})
      assign_attributes(attrs)
      save
    end

    def update!(attrs = {})
      assign_attributes(attrs)
      save!
    end

    def destroy
      return false if new_record? || destroyed?
      pk = primary_key_value
      return false if pk.nil?
      sql = "DELETE FROM #{self.class.table_name} WHERE #{self.class.primary_key} = ?"
      self.class.connection.run(sql, [pk])
      @destroyed = true
      true
    end

    def destroy!
      destroy || raise(ORM::DatabaseError, "レコードの削除に失敗しました")
    end

    def as_json(*)
      attributes
    end

    def to_h
      attributes
    end

    def reload
      raise ORM::RecordNotFound, "未保存のレコードは再読み込みできません" if new_record?
      fresh = self.class.find(primary_key_value)
      @attributes = fresh.attributes
      @new_record = false
      @destroyed = false
      self
    end

    def method_missing(method_name, *args, &block)
      name = method_name.to_s
      if name.end_with?("=")
        attribute = name.delete_suffix("=")
        unless permitted_attribute?(attribute)
          raise ORM::InvalidQuery, "Unknown attribute '#{attribute}' is not assignable"
        end
        return write_attribute(attribute, args.first)
      elsif attribute_defined?(name)
        return read_attribute(name)
      end
      super
    end

    def respond_to_missing?(method_name, include_private = false)
      name = method_name.to_s
      attr_name = name.end_with?("=") ? name.delete_suffix("=") : name
      attribute_defined?(attr_name) || super
    end

    protected

    def read_attribute(name)
      @attributes[name.to_s]
    end

    def write_attribute(name, value)
      @attributes[name.to_s] = value
    end

    private

    def initialize_from_database(row)
      @attributes = {}
      row.each do |key, value|
        write_attribute(key, value)
      end
      @new_record = false
      @destroyed = false
    end

    def attribute_defined?(name)
      key = name.to_s
      permitted_attribute?(key)
    end

    def apply_default_attributes
      self.class.attribute_definitions.each do |name, definition|
        next unless definition.key?(:default)
        default_value = definition[:default]
        value =
          if default_value.respond_to?(:call)
            default_value.call
          else
            duplicate_default(default_value)
          end
        write_attribute(name, value) unless value.nil?
      end
    end

    def duplicate_default(value)
      case value
      when Hash
        value.transform_values { |inner| duplicate_default(inner) }
      when Array
        value.map { |inner| duplicate_default(inner) }
      else
        value
      end
    end

    def permitted_attribute?(name)
      key = name.to_s
      return true if @attributes.key?(key)
      return true if self.class.attribute_definitions.key?(key)
      return true if key == self.class.primary_key
      if self.class.timestamps?
        return true if %w[created_at updated_at].include?(key)
      end
      false
    end

    def insert_record
      apply_timestamps_for_create
      columns, values = insertable_attributes
      raise ORM::InvalidQuery, "保存できる属性がありません" if columns.empty?
      placeholders = Array.new(columns.length, "?").join(", ")
      sql = "INSERT INTO #{self.class.table_name} (#{columns.join(', ')}) VALUES (#{placeholders})"
      result = self.class.connection.run(sql, values)
      assign_last_insert_id(result)
      @new_record = false
      true
    end

    def update_record
      apply_timestamps_for_update
      pk = primary_key_value
      raise ORM::InvalidQuery, "主キーが設定されていません" if pk.nil?
      columns, values = updatable_attributes
      return true if columns.empty?
      assignments = columns.map { |column| "#{column} = ?" }.join(", ")
      sql = "UPDATE #{self.class.table_name} SET #{assignments} WHERE #{self.class.primary_key} = ?"
      values << pk
      self.class.connection.run(sql, values)
      true
    end

    def insertable_attributes
      columns = []
      values = []
      @attributes.each do |key, value|
        next if value.nil?
        columns << key
        values << value
      end
      [columns, values]
    end

    def updatable_attributes
      columns = []
      values = []
      @attributes.each do |key, value|
        next if key == self.class.primary_key
        columns << key
        values << value
      end
      [columns, values]
    end

    def assign_last_insert_id(result)
      pk = self.class.primary_key
      return unless read_attribute(pk).nil?
      last_id = extract_last_insert_id(result)
      write_attribute(pk, last_id) if last_id
    end

    def extract_last_insert_id(result)
      return nil unless result.is_a?(Hash)
      meta = result["meta"] || result[:meta]
      return nil unless meta.is_a?(Hash)
      meta["last_row_id"] || meta[:last_row_id]
    end

    def apply_timestamps_for_create
      return unless self.class.timestamps?
      now = current_timestamp
      write_attribute("created_at", now) if read_attribute("created_at").nil?
      write_attribute("updated_at", now)
    end

    def apply_timestamps_for_update
      return unless self.class.timestamps?
      write_attribute("updated_at", current_timestamp)
    end

    def current_timestamp
      Time.now.utc.iso8601(6)
    end
  end
end
