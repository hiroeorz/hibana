module Hibana
  module Vectorize
    DEFAULT_BINDING_PATTERN = /VECTORIZE$/i

    class Error < StandardError
      attr_reader :details

      def initialize(message, details = nil)
        super(message)
        @details = details || {}
      end
    end

    class Client
      def initialize(binding_name)
        @binding_name = binding_name.to_s
      end

      def upsert(vectors:)
        params = { vectors: normalize_vectors(vectors) }
        invoke(:upsert, params)
      end

      def query(top_k:, vector:, include_metadata: false, include_values: false, filters: nil)
        params = {
          topK: normalize_top_k(top_k),
          vector: normalize_vector_values(vector),
        }
        params[:includeMetadata] = true if include_metadata
        params[:includeValues] = true if include_values
        params[:filter] = normalize_filters(filters) unless filters.nil?
        invoke(:query, params)
      end

      def delete(ids:)
        params = { ids: normalize_ids(ids) }
        invoke(:delete, params)
      end

      private

      def invoke(action, params)
        payload = { binding: @binding_name, action: action, params: params }
        result = HostBridge.vectorize_invoke(payload)
        symbolize_keys(result)
      rescue StandardError => error
        raise Error.new(error.message)
      end

      def normalize_vectors(vectors)
        array = Array(vectors)
        raise ArgumentError, "vectors must include at least one entry" if array.empty?
        array.map.with_index do |entry, idx|
          unless entry.respond_to?(:to_h)
            raise ArgumentError, "vectors[#{idx}] must be hash-like"
          end
          data = entry.to_h
          id = normalize_id(data[:id] || data["id"], idx)
          values = normalize_values(data[:values] || data["values"], idx)
          normalized = { id: id, values: values }
          metadata = data[:metadata] || data["metadata"]
          normalized[:metadata] = normalize_metadata(metadata, idx) unless metadata.nil?
          normalized
        end
      end

      def normalize_id(value, idx)
        text =
          if value.is_a?(String)
            value
          elsif value.respond_to?(:to_str)
            value.to_str
          elsif value.is_a?(Numeric)
            value.to_s
          else
            nil
          end
        if text.nil? || text.empty?
          raise ArgumentError, "vectors[#{idx}] must include non-empty :id"
        end
        text
      end

      def normalize_values(values, idx)
        unless values.is_a?(Array)
          raise ArgumentError, "vectors[#{idx}][:values] must be an array"
        end
        normalized = values.map.with_index do |value, value_idx|
          begin
            Float(value)
          rescue ArgumentError, TypeError
            raise ArgumentError,
              "vectors[#{idx}][:values][#{value_idx}] must be numeric"
          end
        end
        if normalized.empty?
          raise ArgumentError, "vectors[#{idx}][:values] must include at least one value"
        end
        normalized
      end

      def normalize_vector_values(values)
        unless values.is_a?(Array)
          raise ArgumentError, "vector must be an array"
        end
        values.map.with_index do |value, idx|
          begin
            Float(value)
          rescue ArgumentError, TypeError
            raise ArgumentError, "vector[#{idx}] must be numeric"
          end
        end
      end

      def normalize_top_k(value)
        begin
          top_k = Integer(value)
        rescue ArgumentError, TypeError
          raise ArgumentError, "top_k must be an integer"
        end
        raise ArgumentError, "top_k must be positive" if top_k <= 0
        top_k
      end

      def normalize_filters(filters)
        unless filters.respond_to?(:to_h)
          raise ArgumentError, "filters must be hash-like"
        end
        filters.to_h
      end

      def normalize_ids(ids)
        array = Array(ids)
        raise ArgumentError, "ids must include at least one id" if array.empty?
        array.map.with_index do |value, idx|
          text =
            if value.is_a?(String)
              value
            elsif value.respond_to?(:to_str)
              value.to_str
            elsif value.is_a?(Numeric)
              value.to_s
            else
              nil
            end
          if text.nil? || text.empty?
            raise ArgumentError, "ids[#{idx}] must be string-convertible"
          end
          text
        end
      end

      def normalize_metadata(metadata, idx)
        unless metadata.respond_to?(:to_h)
          raise ArgumentError, "vectors[#{idx}][:metadata] must be hash-like"
        end
        metadata.to_h
      end

      def symbolize_keys(obj)
        case obj
        when Hash
          obj.each_with_object({}) do |(key, value), acc|
            symbolized_key = key.is_a?(String) ? key.to_sym : key
            acc[symbolized_key] = symbolize_keys(value)
          end
        when Array
          obj.map { |entry| symbolize_keys(entry) }
        else
          obj
        end
      end
    end

    class << self
      def register(identifier)
        RequestContext.register_binding(identifier) do |_context, binding_name|
          Client.new(binding_name)
        end
      end
    end
  end
end

Hibana::Vectorize.register(Hibana::Vectorize::DEFAULT_BINDING_PATTERN)
