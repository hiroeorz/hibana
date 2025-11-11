declare module "*.wasm" {
  const module: WebAssembly.Module
  export default module
}

declare module "*.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/host_bridge.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/context.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/html_rewriter.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/kv_client.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/d1_client.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/r2_client.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/http_client.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/template_renderer.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/static_server.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/workers_ai_client.rb" {
  const content: string
  export default content
}

declare module "./ruby/app/hibana/routing.rb" {
  const content: string
  export default content
}

declare module "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm" {
  const module: WebAssembly.Module
  export default module
}

interface HTMLRewriterContentOptions {
  html?: boolean
}

interface HTMLRewriterElementAttribute {
  name: string
  value: string
}

interface HTMLRewriterElement {
  readonly tagName: string
  readonly namespaceURI: string | null
  readonly attributes: ReadonlyArray<HTMLRewriterElementAttribute>
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  setInnerContent(content: string, options?: HTMLRewriterContentOptions): void
  setOuterContent(content: string, options?: HTMLRewriterContentOptions): void
  append(content: string, options?: HTMLRewriterContentOptions): void
  prepend(content: string, options?: HTMLRewriterContentOptions): void
  before(content: string, options?: HTMLRewriterContentOptions): void
  after(content: string, options?: HTMLRewriterContentOptions): void
  replace(content: string, options?: HTMLRewriterContentOptions): void
  remove(): void
  removeAndKeepContent(): void
  addClass(className: string): void
  removeClass(className: string): void
  toggleClass(className: string, force?: boolean): void
}

interface HTMLRewriterText {
  readonly text: string
  readonly lastInTextNode: boolean
  replace(content: string, options?: HTMLRewriterContentOptions): void
  before(content: string, options?: HTMLRewriterContentOptions): void
  after(content: string, options?: HTMLRewriterContentOptions): void
  remove(): void
}

interface HTMLRewriterComment {
  readonly text: string
  replace(content: string, options?: HTMLRewriterContentOptions): void
  before(content: string, options?: HTMLRewriterContentOptions): void
  after(content: string, options?: HTMLRewriterContentOptions): void
  remove(): void
}

interface HTMLRewriterDoctype {
  readonly name: string
  readonly publicId: string | null
  readonly systemId: string | null
  replace(content: string, options?: HTMLRewriterContentOptions): void
  before(content: string, options?: HTMLRewriterContentOptions): void
  after(content: string, options?: HTMLRewriterContentOptions): void
  remove(): void
}

interface HTMLRewriterEndTag {
  readonly name: string
  replace(content: string, options?: HTMLRewriterContentOptions): void
  before(content: string, options?: HTMLRewriterContentOptions): void
  after(content: string, options?: HTMLRewriterContentOptions): void
  remove(): void
}

interface HTMLRewriterDocument {
  append(content: string, options?: HTMLRewriterContentOptions): void
  prepend(content: string, options?: HTMLRewriterContentOptions): void
  appendToHead(content: string, options?: HTMLRewriterContentOptions): void
  appendToBody(content: string, options?: HTMLRewriterContentOptions): void
  prependToHead(content: string, options?: HTMLRewriterContentOptions): void
  prependToBody(content: string, options?: HTMLRewriterContentOptions): void
  replace(content: string, options?: HTMLRewriterContentOptions): void
  before(content: string, options?: HTMLRewriterContentOptions): void
  after(content: string, options?: HTMLRewriterContentOptions): void
  end(): void
}

interface HTMLRewriterElementHandlers {
  element?(element: HTMLRewriterElement): void
  text?(text: HTMLRewriterText): void
  comments?(comment: HTMLRewriterComment): void
  doctype?(doctype: HTMLRewriterDoctype): void
  end?(end: HTMLRewriterEndTag): void
}

type HTMLRewriterDocumentHandlers = HTMLRewriterElementHandlers & {
  document?(document: HTMLRewriterDocument): void
}

declare class HTMLRewriter {
  on(selector: string, handlers: HTMLRewriterElementHandlers): HTMLRewriter
  onDocument(handlers: HTMLRewriterDocumentHandlers): HTMLRewriter
  transform(input: Response | string): Response
}
