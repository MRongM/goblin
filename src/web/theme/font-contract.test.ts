import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const readText = (url: URL) => readFileSync(url, 'utf8')

describe('font contract', () => {
  test('uses Maple Mono NF CN as the default app font stacks', () => {
    const contractCss = readText(new URL('./contract.css', import.meta.url))

    expect(contractCss).toContain("--font-sans: 'Maple Mono NF CN'")
    expect(contractCss).toContain("--font-mono: 'Maple Mono NF CN', monospace;")
  })

  test('registers Maple Mono NF CN from bundled Maple Font assets', () => {
    const stylesCss = readText(new URL('../styles.css', import.meta.url))

    expect(stylesCss.match(/font-family: 'Maple Mono NF CN';/g) ?? []).toHaveLength(4)
    expect(stylesCss).toContain("MapleMono-NF-CN-Regular.woff2")
    expect(stylesCss).toContain("MapleMono-NF-CN-Italic.woff2")
    expect(stylesCss).toContain("MapleMono-NF-CN-Bold.woff2")
    expect(stylesCss).toContain("MapleMono-NF-CN-BoldItalic.woff2")
  })
})
