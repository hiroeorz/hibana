require "erb"

module Hibana
  Template = Struct.new(:identifier, :source)

  class TemplateNotFound < StandardError
    attr_reader :identifier

    def initialize(identifier)
      @identifier = identifier.to_s
      super("Template '#{@identifier}' could not be found")
    end
  end

  class Configuration
    attr_reader :template_paths, :template_extensions
    attr_accessor :default_layout

    def initialize
      @template_paths = ["templates"]
      @template_extensions = [".html.erb", ".erb"]
      @default_layout = "layouts/application"
    end

    def template_paths=(paths)
      @template_paths = normalize_paths(paths)
    end

    def template_extensions=(extensions)
      @template_extensions = normalize_extensions(extensions)
    end

    def add_template_path(path)
      normalized = Hibana::TemplateRegistry.normalize_key(path)
      return if normalized.empty? || @template_paths.include?(normalized)

      @template_paths << normalized
    end

    private

    def normalize_paths(paths)
      Array(paths)
        .map { |path| Hibana::TemplateRegistry.normalize_key(path) }
        .reject(&:empty?)
    end

    def normalize_extensions(extensions)
      Array(extensions)
        .map { |ext| ext.to_s.start_with?(".") ? ext.to_s : ".#{ext}" }
        .reject { |ext| ext.strip.empty? }
    end
  end

  class << self
    def config
      @config ||= Configuration.new
    end

    def configure
      yield(config) if block_given?
    end
  end

  module TemplateRegistry
    module_function

    def register(filename, source)
      normalized = normalize_key(filename)
      return if normalized.empty?

      templates[normalized] = source.to_s
    end

    def replace(entries)
      clear
      Array(entries).each do |entry|
        register(entry[:filename], entry[:source])
      end
    end

    def clear
      templates.clear
    end

    def fetch(identifier)
      templates[normalize_key(identifier)]
    end

    def all
      templates.dup
    end

    def normalize_key(value)
      value.to_s
        .tr("\\", "/")
        .strip
        .sub(%r{\A\./}, "")
        .sub(%r{\A/+}, "")
    end

    def templates
      @templates ||= {}
    end
  end

  class TemplateResolver
    def initialize(config: Hibana.config, registry: Hibana::TemplateRegistry)
      @config = config
      @registry = registry
    end

    def find(identifier)
      return nil if identifier.nil? || identifier.to_s.empty?

      candidates_for(identifier).each do |candidate|
        source = @registry.fetch(candidate)
        return Template.new(candidate, source) if source
      end

      nil
    end

    def find!(identifier)
      find(identifier) || raise(TemplateNotFound.new(identifier))
    end

    private

    def candidates_for(identifier)
      normalized = Hibana::TemplateRegistry.normalize_key(identifier)
      return [] if normalized.empty?

      base_candidates = [normalized]
      @config.template_paths.each do |root|
        next if root.nil? || root.empty?
        if normalized.start_with?(root)
          base_candidates << normalized
        else
          base_candidates << join_paths(root, normalized)
        end
      end
      base_candidates.uniq!

      base_candidates.flat_map do |candidate|
        if File.extname(candidate).empty?
          @config.template_extensions.map { |ext| "#{candidate}#{ext}" }
        else
          candidate
        end
      end.uniq
    end

    def join_paths(root, identifier)
      parts = [Hibana::TemplateRegistry.normalize_key(root), identifier]
      parts.reject(&:empty?).join("/")
    end
  end

  class ViewTemplate
    def initialize(identifier, source)
      @identifier = identifier || "(template)"
      @source = source || ""
    end

    def render(view_context, &block)
      erb = ERB.new(@source, trim_mode: "-")
      method_name = :"__hibana_template_#{object_id.abs}_#{rand(1_000_000)}"
      view_context.singleton_class.class_eval <<~RUBY, @identifier, 0
        def #{method_name}(&block)
          #{erb.src}
        end
      RUBY

      begin
        view_context.public_send(method_name, &block)
      ensure
        singleton = view_context.singleton_class
        singleton.send(:remove_method, method_name) if singleton.method_defined?(method_name)
      end
    end
  end

  class ViewContext
    attr_reader :locals

    def initialize(request_context, assigns = {})
      @request_context = request_context
      @locals = {}
      assign_locals(assigns || {})
    end

    def c
      @request_context
    end

    def env(binding_name = nil)
      @request_context.env(binding_name)
    end

    private

    def assign_locals(assigns)
      assigns.each do |raw_key, value|
        next if raw_key.nil?
        key = raw_key.to_sym
        @locals[key] = value

        next unless valid_local_name?(key)
        define_singleton_method(key) { value }
      end
    end

    def valid_local_name?(key)
      key_string = key.to_s
      /\A[a-z_]\w*\z/i.match?(key_string)
    end
  end

  module Renderer
    module_function

    def render(identifier, context:, locals: {}, layout: :default)
      view_context = ViewContext.new(context, symbolize_keys(locals))
      resolver = TemplateResolver.new
      template = resolver.find!(identifier)

      content = ViewTemplate.new(template.identifier, template.source).render(view_context)

      layout_name = resolve_layout(layout)
      return content unless layout_name && !layout_name.to_s.empty?

      layout_template = resolver.find!(layout_name)
      ViewTemplate.new(layout_template.identifier, layout_template.source).render(view_context) do
        content
      end
    end

    def resolve_layout(layout_option)
      case layout_option
      when false
        nil
      when nil, true, :default
        Hibana.config.default_layout
      else
        layout_option.to_s
      end
    end

    def symbolize_keys(locals)
      return {} if locals.nil?
      unless locals.respond_to?(:each)
        raise ArgumentError, "locals must be provided as a hash-like object"
      end

      locals.each_with_object({}) do |(key, value), acc|
        key_sym = key.to_sym
        acc[key_sym] = value
      end
    end
  end
end
