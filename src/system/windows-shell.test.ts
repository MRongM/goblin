import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const spawnSyncMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}))

const { resolveWindowsTerminalShell } = await import('#/system/windows-shell.ts')

function makeTempDir() {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'goblin-windows-shell-test-'))
  return {
    path: temporaryDirectory,
    [Symbol.dispose]() {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    },
  }
}

function makeExecutable(directory: string, name: string): string {
  const executable = path.join(directory, name)
  writeFileSync(executable, '')
  return executable
}

function windowsEnv(directory: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: directory,
    PATHEXT: '.EXE',
    SystemRoot: path.join(directory, 'missing-system-root'),
    ...overrides,
  }
}

beforeEach(() => {
  spawnSyncMock.mockReset()
})

describe('resolveWindowsTerminalShell', () => {
  test('prefers WSL when an installed distribution is reported', () => {
    using temporaryDirectory = makeTempDir()
    const wsl = makeExecutable(temporaryDirectory.path, 'wsl.exe')
    makeExecutable(temporaryDirectory.path, 'pwsh.exe')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'U\0b\0u\0n\0t\0u\0\r\0\n\0' })

    expect(
      resolveWindowsTerminalShell({
        cwd: 'C:\\repo',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'wsl',
      command: wsl,
      args: ['--cd', 'C:\\repo'],
    })
    expect(spawnSyncMock).toHaveBeenCalledWith(
      wsl,
      ['--list', '--quiet'],
      expect.objectContaining({ encoding: 'utf8', timeout: 2_000, windowsHide: true }),
    )
  })

  test('retains the WSL distribution identity and Linux path for a wsl.localhost target', () => {
    using temporaryDirectory = makeTempDir()
    const wsl = makeExecutable(temporaryDirectory.path, 'wsl.exe')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'Ubuntu-24.04\r\n' })

    expect(
      resolveWindowsTerminalShell({
        cwd: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\developer\\repo',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'wsl',
      command: wsl,
      args: ['--distribution', 'Ubuntu-24.04', '--cd', '/home/developer/repo'],
    })
  })

  test('retains the WSL distribution identity for the legacy wsl$ target form', () => {
    using temporaryDirectory = makeTempDir()
    const wsl = makeExecutable(temporaryDirectory.path, 'wsl.exe')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'Debian\r\n' })

    expect(
      resolveWindowsTerminalShell({
        cwd: '\\\\wsl$\\Debian\\srv\\repo',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toMatchObject({
      kind: 'wsl',
      args: ['--distribution', 'Debian', '--cd', '/srv/repo'],
    })
  })

  test('runs a startup command through WSL and returns to the distribution default shell', () => {
    using temporaryDirectory = makeTempDir()
    const wsl = makeExecutable(temporaryDirectory.path, 'wsl.exe')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'Ubuntu\r\n' })

    expect(
      resolveWindowsTerminalShell({
        cwd: 'D:\\repo',
        startupShellCommand: "bat '/mnt/d/repo/README.md'",
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'wsl',
      command: wsl,
      args: ['--cd', 'D:\\repo', '--exec', 'sh', '-lc', 'bat \'/mnt/d/repo/README.md\'\nexec "${SHELL:-/bin/sh}" -l'],
    })
  })

  test('uses PowerShell 7 when WSL has no installed distribution', () => {
    using temporaryDirectory = makeTempDir()
    makeExecutable(temporaryDirectory.path, 'wsl.exe')
    const pwsh = makeExecutable(temporaryDirectory.path, 'pwsh.exe')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '\0\r\0\n\0' })

    expect(
      resolveWindowsTerminalShell({
        cwd: 'C:\\repo',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'powershell',
      command: pwsh,
      args: ['-NoLogo'],
    })
  })

  test('uses PowerShell when probing WSL fails', () => {
    using temporaryDirectory = makeTempDir()
    makeExecutable(temporaryDirectory.path, 'wsl.exe')
    const pwsh = makeExecutable(temporaryDirectory.path, 'pwsh.exe')
    spawnSyncMock.mockReturnValue({ status: 1, stdout: 'Ubuntu\r\n' })

    expect(
      resolveWindowsTerminalShell({
        cwd: 'C:\\repo',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'powershell',
      command: pwsh,
      args: ['-NoLogo'],
    })
  })

  test('uses the Windows PowerShell system executable when PowerShell 7 is absent', () => {
    using temporaryDirectory = makeTempDir()
    const systemRoot = path.join(temporaryDirectory.path, 'Windows')
    const powershellDirectory = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
    mkdirSync(powershellDirectory, { recursive: true })
    const powershell = makeExecutable(powershellDirectory, 'powershell.exe')

    expect(
      resolveWindowsTerminalShell({
        cwd: 'C:\\repo',
        env: windowsEnv(temporaryDirectory.path, { SystemRoot: systemRoot }),
      }),
    ).toEqual({
      kind: 'powershell',
      command: powershell,
      args: ['-NoLogo'],
    })
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  test('falls back to the stable powershell.exe command name', () => {
    using temporaryDirectory = makeTempDir()

    expect(
      resolveWindowsTerminalShell({
        cwd: 'C:\\repo',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'powershell',
      command: 'powershell.exe',
      args: ['-NoLogo'],
    })
  })

  test('keeps PowerShell open after a startup command', () => {
    using temporaryDirectory = makeTempDir()
    const pwsh = makeExecutable(temporaryDirectory.path, 'pwsh.exe')

    expect(
      resolveWindowsTerminalShell({
        cwd: 'C:\\repo',
        startupShellCommand: 'Get-ChildItem',
        env: windowsEnv(temporaryDirectory.path),
      }),
    ).toEqual({
      kind: 'powershell',
      command: pwsh,
      args: ['-NoLogo', '-NoExit', '-Command', 'Get-ChildItem'],
    })
  })
})
