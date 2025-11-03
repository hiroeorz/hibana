declare module "degit" {
  interface DegitOptions {
    cache?: boolean;
    force?: boolean;
    verbose?: boolean;
  }

  interface DegitEmitter {
    clone(destination: string): Promise<void>;
  }

  export default function degit(
    repo: string,
    options?: DegitOptions
  ): DegitEmitter;
}
