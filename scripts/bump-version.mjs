#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {}
  for (const arg of args) {
    const [key, value] = arg.split("=")
    if (!value) {
      throw new Error(`Invalid argument '${arg}'. Expected key=value form.`)
    }
    options[key.replace(/^--/, "")] = value
  }
  return options
}

function updatePackageJson(path, updater) {
  const file = resolve(process.cwd(), path)
  const data = JSON.parse(readFileSync(file, "utf8"))
  const updated = updater(data)
  writeFileSync(file, JSON.stringify(updated, null, 2) + "\n")
}

function updateConstants(version) {
  const file = resolve(process.cwd(), "packages/cli/src/constants.ts")
  const source = readFileSync(file, "utf8")
  const pattern = /(export const RUNTIME_PACKAGE_VERSION = ")[^"]+(";)/m
  if (!pattern.test(source)) {
    throw new Error("Failed to find RUNTIME_PACKAGE_VERSION in constants.ts")
  }
  const next = source.replace(pattern, `$1^${version}$2`)
  writeFileSync(file, next)
}

function main() {
  const args = parseArgs()
  const runtimeVersion = args.runtime
  const cliVersion = args.cli
  if (!runtimeVersion || !cliVersion) {
    throw new Error("--runtime and --cli versions are required")
  }

  updatePackageJson("packages/runtime/package.json", (data) => ({
    ...data,
    version: runtimeVersion,
  }))

  updatePackageJson("packages/cli/package.json", (data) => ({
    ...data,
    version: cliVersion,
  }))

  updateConstants(runtimeVersion)

  console.log(
    `Updated runtime to ${runtimeVersion} and CLI to ${cliVersion}. Remember to review package-lock.json`,
  )
}

main()
