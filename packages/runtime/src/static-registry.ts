export type StaticAsset = { filename: string; body: string; contentType?: string }

let staticAssets: StaticAsset[] = []

export function setStaticAssets(assets: StaticAsset[]): void {
  staticAssets = [...assets]
}

export function addStaticAsset(asset: StaticAsset): void {
  staticAssets = [...staticAssets, asset]
}

export function clearStaticAssets(): void {
  staticAssets = []
}

export function getStaticAssets(): readonly StaticAsset[] {
  return staticAssets
}
