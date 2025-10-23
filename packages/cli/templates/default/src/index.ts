import wasmModule from '../dist/wasm/app.wasm';

let instancePromise: Promise<WebAssembly.Instance> | undefined;

const getInstance = (): Promise<WebAssembly.Instance> => {
  if (!instancePromise) {
    instancePromise = WebAssembly.instantiate(wasmModule, {});
  }
  return instancePromise;
};

export default {
  async fetch(request: Request): Promise<Response> {
    await getInstance();

    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Hello from Hibana!', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
