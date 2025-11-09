#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const runtimePkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "packages/runtime/package.json"), "utf8"),
)
const cliPkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "packages/cli/package.json"), "utf8"),
)
const constants = readFileSync(
  resolve(process.cwd(), "packages/cli/src/constants.ts"),
  "utf8",
)
const match = constants.match(/RUNTIME_PACKAGE_VERSION = "([^\"]+)/)
const pinned = match ? match[1] : "unknown"

console.log(`Runtime package.json: ${runtimePkg.version}`)
console.log(`CLI package.json: ${cliPkg.version}`)
console.log(`CLI pinned runtime: ${pinned}`)
