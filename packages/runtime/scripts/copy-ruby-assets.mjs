import { cpSync, existsSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()
const source = resolve(root, "src", "ruby")
const destination = resolve(root, "dist", "ruby")

if (!existsSync(source)) {
  console.warn(`[copy-ruby-assets] source directory not found: ${source}`)
  process.exit(0)
}

if (existsSync(destination)) {
  rmSync(destination, { recursive: true, force: true })
}

cpSync(source, destination, { recursive: true })
