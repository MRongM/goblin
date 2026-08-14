// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const terminalSessionCss = readFileSync(new URL('./terminal-session.css', import.meta.url), 'utf8')

describe('terminal session cursor styles', () => {
  test('keeps the Windows xterm cursor static when a TUI requests DEC cursor blinking', () => {
    expect(terminalSessionCss).toMatch(
      /\.goblin-managed-terminal-host\.goblin-terminal-static-cursor\s+\.xterm-cursor\.xterm-cursor-blink\s*\{[^}]*animation:\s*none\s*!important;[^}]*\}/,
    )
  })

  test('does not install a synchronized-output cursor proxy', () => {
    expect(terminalSessionCss).not.toContain('goblin-terminal-output-cursor-stabilized')
    expect(terminalSessionCss).not.toContain('goblin-terminal-output-cursor-proxy')
  })
})
