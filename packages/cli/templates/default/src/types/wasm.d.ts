declare module '*.wasm' {
  const wasm: WebAssembly.Module | ArrayBuffer | Promise<WebAssembly.Module>;
  export default wasm;
}
