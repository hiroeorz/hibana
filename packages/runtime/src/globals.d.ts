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
