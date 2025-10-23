# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'json'
require 'open3'
require 'pathname'
require 'rubygems/package'
require 'shellwords'
require 'time'
require 'zlib'

module Hibana
  module Wasm
    class BuildError < StandardError; end

    class Builder
      DEFAULT_SOURCE_GLOBS = [
        'app/**/*.rb',
        'lib/**/*.rb',
        'config/**/*.rb'
      ].freeze

      DEFAULT_OUTPUT_DIR = 'dist/wasm'
      DEFAULT_WASM_FILENAME = 'app.wasm'
      DEFAULT_SOURCES_ARCHIVE = 'sources.tar.gz'
      DEFAULT_MANIFEST_FILENAME = 'manifest.json'
      DEFAULT_ENTRYPOINT = 'app/app.rb'
      DEFAULT_RUNTIME_PACKAGE = '@ruby/3.4-wasm-wasi'
      DEFAULT_RUNTIME_FILENAME = 'ruby+stdlib.wasm'
      BUILDER_SOURCE_FILE = 'lib/hibana/wasm/builder.rb'
      BUILDER_NAMESPACE_PREFIX = 'lib/hibana/wasm/'
      BuildReport = Struct.new(
        :wasm_path,
        :manifest_path,
        :sources_archive_path,
        :strategy,
        :source_count,
        keyword_init: true
      ) do
        def summary
          <<~MSG
            Strategy: #{strategy}
            Sources bundled: #{source_count}
            WASM: #{relative_path(wasm_path)}
            Sources archive: #{relative_path(sources_archive_path)}
            Manifest: #{relative_path(manifest_path)}
          MSG
        end

        private

        def relative_path(path)
          Pathname.new(path).relative_path_from(Pathname.new(Dir.pwd)).to_s
        rescue StandardError
          path
        end
      end

      def initialize(project_root: Dir.pwd, env: ENV)
        @project_root = Pathname.new(project_root)
        @env = env
      end

      def build
        FileUtils.mkdir_p(output_dir)
        sources_archive = package_sources
        compilation = compile
        manifest_path = write_manifest(
          compilation[:strategy],
          wasm_basename: File.basename(compilation[:wasm_path]),
          sources_archive: File.basename(sources_archive)
        )

        BuildReport.new(
          wasm_path: compilation[:wasm_path],
          manifest_path: manifest_path,
          sources_archive_path: sources_archive,
          strategy: compilation[:strategy],
          source_count: source_files.count
        )
      end

      private

      attr_reader :project_root, :env

      def compile
        command_template = env['HIBANA_WASM_BUILD']
        if command_template && !command_template.strip.empty?
          run_external(command_template)
        else
          build_with_bundled_runtime
        end
      end

      def run_external(command_template)
        command = format_command(command_template)
        stdout, stderr, status = Open3.capture3(*command, chdir: project_root.to_s)

        unless status.success?
          raise BuildError, <<~MSG
            WebAssembly build command failed (#{status.exitstatus}):
            #{command.join(' ')}
            #{stderr}
          MSG
        end

        wasm_path = locate_wasm_output
        puts(stdout) unless stdout.strip.empty?

        { wasm_path: wasm_path, strategy: 'external command' }
      end

      def format_command(template)
        formatted = format(
          template,
          project_root: project_root.to_s,
          output_dir: output_dir.to_s
        )
        Shellwords.split(formatted)
      rescue KeyError => e
        raise BuildError, "Invalid HIBANA_WASM_BUILD template: #{e.message}"
      end

      def locate_wasm_output
        wasm_files = Dir.glob(output_dir.join('*.wasm')).select { |path| File.file?(path) }
        raise BuildError, "External build did not produce any .wasm file in #{output_dir}" if wasm_files.empty?

        wasm_files.first
      end

      def build_with_bundled_runtime
        runtime_wasm = bundled_runtime_path
        unless runtime_wasm && File.file?(runtime_wasm)
          raise BuildError, <<~MSG
            Could not locate #{DEFAULT_RUNTIME_FILENAME} from #{DEFAULT_RUNTIME_PACKAGE}.
            Ensure `npm install` has been run and the package is listed in package.json.
          MSG
        end

        wasm_path = output_dir.join(DEFAULT_WASM_FILENAME)
        FileUtils.cp(runtime_wasm, wasm_path)

        { wasm_path: wasm_path, strategy: 'bundled runtime' }
      end

      def write_manifest(strategy, wasm_basename:, sources_archive:)
        manifest_path = output_dir.join(DEFAULT_MANIFEST_FILENAME)
        manifest = {
          generated_at: Time.now.utc.iso8601,
          ruby_version: RUBY_VERSION,
          placeholder: strategy == 'placeholder',
          strategy: strategy,
          runtime_package: DEFAULT_RUNTIME_PACKAGE,
          wasm: wasm_basename,
          entrypoint: DEFAULT_ENTRYPOINT,
          sources_archive: sources_archive,
          sources: source_files.map do |path|
            {
              path: relativize(path),
              size: File.size(path),
              digest: Digest::SHA256.file(path).hexdigest
            }
          end
        }

        File.write(manifest_path, JSON.pretty_generate(manifest))
        manifest_path
      end

      def source_files
        @source_files ||= DEFAULT_SOURCE_GLOBS.flat_map do |pattern|
          Dir.glob(project_root.join(pattern).to_s, File::FNM_PATHNAME)
        end.select do |file|
          File.file?(file)
        end.reject do |file|
          relative = relativize(file)
          relative == BUILDER_SOURCE_FILE || relative.start_with?(BUILDER_NAMESPACE_PREFIX)
        end
      end

      def output_dir
        @output_dir ||= project_root.join(DEFAULT_OUTPUT_DIR)
      end

      def package_sources
        archive_path = output_dir.join(DEFAULT_SOURCES_ARCHIVE)

        Zlib::GzipWriter.open(archive_path.to_s) do |gzip|
          Gem::Package::TarWriter.new(gzip) do |tar|
            source_files.each do |file_path|
              relative = relativize(file_path)
              mode = File.stat(file_path).mode & 0o777
              tar.add_file_simple(relative, mode.zero? ? 0o644 : mode, File.size(file_path)) do |io|
                File.open(file_path, 'rb') { |file| io.write(file.read) }
              end
            end
          end
        end

        archive_path
      end

      def bundled_runtime_path
        path = project_root.join('node_modules', '@ruby', '3.4-wasm-wasi', 'dist', DEFAULT_RUNTIME_FILENAME)
        path if path.file?
      end

      def relativize(path)
        Pathname.new(path).relative_path_from(project_root).to_s
      rescue StandardError
        path
      end

      def builder_source_dir
        @builder_source_dir ||= project_root.join('lib', 'hibana', 'wasm').to_s
      end
    end
  end
end
