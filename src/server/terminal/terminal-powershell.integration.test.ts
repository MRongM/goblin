import { describe, expect, test } from 'vitest'
import { spawnTerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'

describe('Windows PowerShell terminal integration', () => {
  test.runIf(process.platform === 'win32')('streams PowerShell output through ConPTY', async () => {
    const marker = 'GOBLIN_POWERSHELL_CONPTY_OK'
    let output = ''
    let resolveMarker: (() => void) | null = null
    let resolveExit: (() => void) | null = null
    const markerSeen = new Promise<void>((resolve) => {
      resolveMarker = resolve
    })
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const result = spawnTerminalPtyRuntime(
      {
        cwd: process.cwd(),
        cols: 100,
        rows: 30,
        startupShellCommand: `Write-Output ${marker}`,
      },
      {
        onData(data) {
          output += data
          if (output.includes(marker)) resolveMarker?.()
        },
        onExit() {
          resolveExit?.()
        },
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    try {
      await markerSeen
      expect(output).toContain(marker)
    } finally {
      result.events.disposeData()
      result.runtime.kill()
      await exited
    }
  })
})
