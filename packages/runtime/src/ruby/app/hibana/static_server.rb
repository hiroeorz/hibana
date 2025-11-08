module Hibana
  module StaticRegistry
    module_function

    def register(filename, body, content_type = nil)
      assets[normalize(filename)] = {
        body: body || "",
        content_type: content_type,
      }
    end

    def replace(entries)
      clear
      Array(entries).each do |entry|
        next unless entry
        register(entry[:filename], entry[:body], entry[:content_type])
      end
    end

    def clear
      assets.clear
    end

    def find(path)
      assets[normalize(path)]
    end

    def assets
      @assets ||= {}
    end

    def normalize(path)
      path.to_s.tr("\\", "/").strip.sub(%r{\A/+}, "")
    end
  end

  class StaticServer
    DEFAULT_TYPES = {
      ".html" => "text/html; charset=UTF-8",
      ".htm" => "text/html; charset=UTF-8",
      ".css" => "text/css; charset=UTF-8",
      ".js" => "application/javascript; charset=UTF-8",
      ".json" => "application/json; charset=UTF-8",
      ".txt" => "text/plain; charset=UTF-8",
      ".svg" => "image/svg+xml",
      ".png" => "image/png",
      ".jpg" => "image/jpeg",
      ".jpeg" => "image/jpeg",
      ".gif" => "image/gif",
      ".webp" => "image/webp",
    }.freeze

    def initialize(registry: Hibana::StaticRegistry)
      @registry = registry
    end

    def call(path)
      normalized = normalize_path(path)
      entry = @registry.find(normalized)
      return nil unless entry

      headers = {
        "content-type" => determine_content_type(normalized, entry[:content_type]),
      }
      Response.new(body: entry[:body], status: 200, headers: headers)
    end

    private

    def normalize_path(path)
      value = path.to_s
      value = value.split("?").first if value.include?("?")
      Hibana::StaticRegistry.normalize(value)
    end

    def determine_content_type(path, explicit)
      return explicit if explicit && !explicit.empty?
      ext = File.extname(path)
      DEFAULT_TYPES.fetch(ext, "application/octet-stream")
    end
  end
end
