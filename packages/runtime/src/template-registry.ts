export type TemplateAsset = {
  filename: string
  source: string
}

let templateAssets: TemplateAsset[] = []

export function setTemplateAssets(assets: TemplateAsset[]): void {
  templateAssets = [...assets]
}

export function addTemplateAsset(asset: TemplateAsset): void {
  templateAssets = [...templateAssets, asset]
}

export function addTemplateAssets(assets: TemplateAsset[]): void {
  templateAssets = [...templateAssets, ...assets]
}

export function clearTemplateAssets(): void {
  templateAssets = []
}

export function getTemplateAssets(): readonly TemplateAsset[] {
  return templateAssets
}
