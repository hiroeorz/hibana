export type RubyScript = { filename: string; source: string }

let applicationScripts: RubyScript[] = []

export function setApplicationScripts(scripts: RubyScript[]): void {
  applicationScripts = [...scripts]
}

export function addApplicationScript(script: RubyScript): void {
  applicationScripts = [...applicationScripts, script]
}

export function getApplicationScripts(): readonly RubyScript[] {
  return applicationScripts
}

export function clearApplicationScripts(): void {
  applicationScripts = []
}
