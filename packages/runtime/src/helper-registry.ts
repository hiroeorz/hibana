export type HelperScript = { filename: string; source: string }

let registeredScripts: HelperScript[] = []

export function setHelperScripts(scripts: HelperScript[]): void {
  registeredScripts = [...scripts]
}

export function addHelperScripts(scripts: HelperScript[]): void {
  registeredScripts = [...registeredScripts, ...scripts]
}

export function getHelperScripts(): readonly HelperScript[] {
  return registeredScripts
}

export function clearHelperScripts(): void {
  registeredScripts = []
}
