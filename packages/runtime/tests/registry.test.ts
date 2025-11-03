import { describe, it, expect, beforeEach } from "vitest"
import {
  addHelperScripts,
  clearHelperScripts,
  getHelperScripts,
  setHelperScripts,
  type HelperScript,
} from "../src/helper-registry"
import {
  addApplicationScript,
  clearApplicationScripts,
  getApplicationScripts,
  setApplicationScripts,
  type RubyScript,
} from "../src/script-registry"

describe("helper registry", () => {
  const helperA: HelperScript = { filename: "a.rb", source: "puts 'a'" }
  const helperB: HelperScript = { filename: "b.rb", source: "puts 'b'" }

  beforeEach(() => {
    clearHelperScripts()
  })

  it("setHelperScripts overwrites existing entries", () => {
    setHelperScripts([helperA])
    expect(getHelperScripts()).toEqual([helperA])

    setHelperScripts([helperB])
    expect(getHelperScripts()).toEqual([helperB])
  })

  it("addHelperScripts appends to existing entries", () => {
    setHelperScripts([helperA])
    addHelperScripts([helperB])
    expect(getHelperScripts()).toEqual([helperA, helperB])
  })
})

describe("application script registry", () => {
  const scriptA: RubyScript = { filename: "app/app_a.rb", source: "puts 'a'" }
  const scriptB: RubyScript = { filename: "app/app_b.rb", source: "puts 'b'" }

  beforeEach(() => {
    clearApplicationScripts()
  })

  it("setApplicationScripts replaces current scripts", () => {
    setApplicationScripts([scriptA])
    expect(getApplicationScripts()).toEqual([scriptA])

    setApplicationScripts([scriptB])
    expect(getApplicationScripts()).toEqual([scriptB])
  })

  it("addApplicationScript appends a single script", () => {
    setApplicationScripts([scriptA])
    addApplicationScript(scriptB)
    expect(getApplicationScripts()).toEqual([scriptA, scriptB])
  })
})
