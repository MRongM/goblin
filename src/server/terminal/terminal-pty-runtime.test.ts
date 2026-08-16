import { userInfo } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveLocalShell, resolveLocalShellWithStartupShellCommand } from '#/server/terminal/terminal-local-shell.ts'
import { resolveWindowsTerminalShell } from '#/system/windows-shell.ts'
import {
  spawnTerminalPtyRuntime as spawnTerminalPtyRuntimeWithEvents,
  type SpawnTerminalPtyRuntimeInput,
} from '#/server/terminal/terminal-pty-runtime.ts'
import type * as NodeOsModule from 'node:os'

const { spawnMock, resolveWindowsTerminalShellMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolveWindowsTerminalShellMock: vi.fn(),
}))

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}))

vi.mock('#/system/windows-shell.ts', () => ({
  resolveWindowsTerminalShell: resolveWindowsTerminalShellMock,
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOsModule>()
  return {
    ...actual,
    userInfo: vi.fn(),
  }
})

const originalShell = process.env.SHELL
const originalPlatform = process.platform
const terminalEventObserver = { onData: vi.fn(), onExit: vi.fn() }

function spawnTerminalPtyRuntime(input: SpawnTerminalPtyRuntimeInput) {
  return spawnTerminalPtyRuntimeWithEvents(input, terminalEventObserver)
}

beforeEach(() => {
  spawnMock.mockReset()
  resolveWindowsTerminalShellMock.mockReset()
  resolveWindowsTerminalShellMock.mockReturnValue({
    kind: 'wsl',
    command: 'C:\\Windows\\System32\\wsl.exe',
    args: ['--cd', 'C:\\repo'],
  })
  terminalEventObserver.onData.mockReset()
  terminalEventObserver.onExit.mockReset()
  vi.mocked(userInfo).mockReset()
  // Force a stable test env. Without this, a CI runner with SHELL=
  // (or unset) would skip the inherited-SHELL branch and the test
  // would race against the host environment.
  process.env.SHELL = '/bin/zsh'
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  if (originalShell === undefined) delete process.env.SHELL
  else process.env.SHELL = originalShell
})

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return run()
}

function ptyStub(processName = 'zsh') {
  return {
    process: processName,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((_listener: (data: string) => void) => ({ dispose: vi.fn() })),
    onExit: vi.fn((_listener: () => void) => ({ dispose: vi.fn() })),
  }
}

describe('spawnTerminalPtyRuntime', () => {
  test('uses the shared Windows shell policy for a default internal terminal', () => {
    withPlatform('win32', () => {
      const env = { PATH: 'C:\\Windows\\System32' }
      const resolved = resolveLocalShell({ cwd: 'C:\\repo' }, env)

      expect(resolved).toEqual({
        kind: 'wsl',
        command: 'C:\\Windows\\System32\\wsl.exe',
        args: ['--cd', 'C:\\repo'],
      })
      expect(resolveWindowsTerminalShell).toHaveBeenCalledWith({ cwd: 'C:\\repo', env })
    })
  })

  test('passes startup commands and the working directory to the shared Windows shell policy', () => {
    withPlatform('win32', () => {
      const env = { PATH: 'C:\\Windows\\System32' }
      resolveWindowsTerminalShellMock.mockReturnValue({
        kind: 'powershell',
        command: 'pwsh.exe',
        args: ['-NoLogo', '-NoExit', '-Command', 'Get-ChildItem'],
      })

      expect(resolveLocalShellWithStartupShellCommand('Get-ChildItem\r\n', 'C:\\repo', env)).toEqual({
        kind: 'powershell',
        command: 'pwsh.exe',
        args: ['-NoLogo', '-NoExit', '-Command', 'Get-ChildItem'],
      })
      expect(resolveWindowsTerminalShell).toHaveBeenCalledWith({
        cwd: 'C:\\repo',
        env,
        startupShellCommand: 'Get-ChildItem',
      })
    })
  })

  test('spawns the Windows shell selected for the admitted terminal without a second fallback', () => {
    withPlatform('win32', () => {
      const selectedShell = {
        kind: 'wsl' as const,
        command: 'C:\\Windows\\System32\\wsl.exe',
        args: ['--cd', 'C:\\repo'],
      }
      resolveWindowsTerminalShellMock.mockReturnValue(selectedShell)
      spawnMock.mockReturnValue(ptyStub('wsl.exe'))

      const result = spawnTerminalPtyRuntime({ cwd: 'C:\\repo', cols: 80, rows: 24 })

      expect(result.ok).toBe(true)
      expect(resolveWindowsTerminalShell).toHaveBeenCalledOnce()
      expect(spawnMock).toHaveBeenCalledOnce()
      expect(spawnMock).toHaveBeenCalledWith(
        selectedShell.command,
        selectedShell.args,
        expect.objectContaining({ cwd: 'C:\\repo' }),
      )
    })
  })

  test('keeps an explicit process command authoritative on Windows', () => {
    withPlatform('win32', () => {
      spawnMock.mockReturnValue(ptyStub('fish'))

      spawnTerminalPtyRuntime({
        command: 'C:\\tools\\fish.exe',
        args: ['--login'],
        cwd: 'C:\\repo',
        cols: 80,
        rows: 24,
      })

      expect(resolveWindowsTerminalShell).not.toHaveBeenCalled()
      expect(spawnMock).toHaveBeenCalledWith(
        'C:\\tools\\fish.exe',
        ['--login'],
        expect.objectContaining({ cwd: 'C:\\repo' }),
      )
    })
  })

  test('returns a trimmed process name when node-pty exposes a string', () => {
    spawnMock.mockReturnValue({
      process: ' zsh ',
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    })

    const result = spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.runtime.processName()).toBe('zsh')
  })

  test('falls back to terminal when the process getter throws', () => {
    spawnMock.mockReturnValue({
      get process() {
        throw new Error('process unavailable')
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    })

    const result = spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.runtime.processName()).toBe('terminal')
  })

  test('reads the process getter only once per lookup', () => {
    let reads = 0
    spawnMock.mockReturnValue({
      get process() {
        reads += 1
        return reads === 1 ? 'zsh' : undefined
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    })

    const result = spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.runtime.processName()).toBe('zsh')
    expect(reads).toBe(1)
  })

  test('honours an explicit command override without consulting env or passwd', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/bin/zsh' } as ReturnType<typeof userInfo>)
    spawnMock.mockReturnValue(ptyStub())

    spawnTerminalPtyRuntime({
      command: '/usr/local/bin/fish',
      args: ['--login'],
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/fish',
      ['--login'],
      expect.objectContaining({ cwd: '/repo' }),
    )
    // Explicit override must short-circuit both env and userInfo lookups —
    // otherwise a future regression that always polls userInfo would slow
    // every explicit-override spawn by an os syscall.
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('uses the inherited SHELL on Unix when it is set, with -l for login mode', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/bin/zsh' } as ReturnType<typeof userInfo>)
    spawnMock.mockReturnValue(ptyStub())

    spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(spawnMock).toHaveBeenCalledWith('/bin/zsh', ['-l'], expect.objectContaining({ cwd: '/repo' }))
    // Explicit env.SHELL must win — passwd fallback is only consulted when
    // the inherited env is silent (CI / devcontainer scenarios).
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('runs a startup shell command through the login shell and returns to an interactive shell', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/bin/zsh' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShellWithStartupShellCommand("  bat '/repo/README.md'\r", '/repo', {
      SHELL: '/bin/zsh',
    })

    expect(resolved).toEqual({
      command: '/bin/zsh',
      args: ['-ilc', "  bat '/repo/README.md'\nexec '/bin/zsh' -l"],
    })
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('startup shell command resolution falls back to normal shell resolution for blank commands', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/bin/zsh' } as ReturnType<typeof userInfo>)

    expect(resolveLocalShellWithStartupShellCommand(' \r\n ', '/repo', { SHELL: '/bin/zsh' })).toEqual({
      command: '/bin/zsh',
      args: ['-l'],
    })
  })

  test('rejects mixing startup shell command with explicit process command', () => {
    const result = spawnTerminalPtyRuntime({
      command: '/bin/zsh',
      startupShellCommand: "bat '/repo/README.md'",
      cwd: '/repo',
      cols: 80,
      rows: 24,
    })

    expect(result).toEqual({ ok: false, message: 'startupShellCommand cannot be combined with command or args' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  test('installs data ownership before returning the runtime capability', () => {
    const term = ptyStub()
    term.onData.mockImplementation((listener: (data: string) => void) => {
      listener('early output')
      return { dispose: vi.fn() }
    })
    spawnMock.mockReturnValue(term)

    const result = spawnTerminalPtyRuntime({ cwd: '/repo', cols: 80, rows: 24 })

    expect(result.ok).toBe(true)
    expect(terminalEventObserver.onData).toHaveBeenCalledWith('early output', 'zsh')
  })

  test('fails spawn and kills the candidate when data observer installation throws', () => {
    const term = ptyStub()
    term.onData.mockImplementation(() => {
      throw new Error('data observer unavailable')
    })
    spawnMock.mockReturnValue(term)

    expect(spawnTerminalPtyRuntime({ cwd: '/repo', cols: 80, rows: 24 })).toEqual({
      ok: false,
      message: 'data observer unavailable',
    })
    expect(term.kill).toHaveBeenCalledOnce()
    expect(term.onExit).not.toHaveBeenCalled()
  })

  test('releases data ownership and kills the candidate when exit observer installation throws', () => {
    const dataDisposable = { dispose: vi.fn() }
    const term = ptyStub()
    term.onData.mockReturnValue(dataDisposable)
    term.onExit.mockImplementation(() => {
      throw new Error('exit observer unavailable')
    })
    spawnMock.mockReturnValue(term)

    expect(spawnTerminalPtyRuntime({ cwd: '/repo', cols: 80, rows: 24 })).toEqual({
      ok: false,
      message: 'exit observer unavailable',
    })
    expect(dataDisposable.dispose).toHaveBeenCalledOnce()
    expect(term.kill).toHaveBeenCalledOnce()
  })

  test('merges caller env into the spawned PTY environment while keeping terminal TERM', () => {
    spawnMock.mockReturnValue(ptyStub())

    spawnTerminalPtyRuntime({
      cwd: '/repo',
      cols: 80,
      rows: 24,
      env: {
        PATH: '/g/bin:/usr/bin',
        GOBLIN_TERMINAL: '1',
        TERM: 'bad-term',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ASAR: '1',
      },
    })

    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-l'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/g/bin:/usr/bin',
          GOBLIN_TERMINAL: '1',
          TERM: 'xterm-256color',
        }),
      }),
    )
    const spawnOptions = spawnMock.mock.calls[0]![2]
    expect(spawnOptions.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(spawnOptions.env).not.toHaveProperty('ELECTRON_NO_ASAR')
  })

  test('falls back to os.userInfo().shell when SHELL is not set (CI / devcontainer)', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/usr/bin/zsh' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShell({ cwd: '/repo' }, { PATH: '/usr/bin' })

    expect(resolved).toEqual({ command: '/usr/bin/zsh', args: ['-l'] })
    expect(userInfo).toHaveBeenCalledTimes(1)
  })

  test('treats whitespace-only SHELL as unset and falls through to userInfo', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '/usr/bin/zsh' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShell({ cwd: '/repo' }, { SHELL: '   ' })

    expect(resolved).toEqual({ command: '/usr/bin/zsh', args: ['-l'] })
  })

  test('treats whitespace-only userInfo().shell as unset and falls back to /bin/sh', () => {
    vi.mocked(userInfo).mockReturnValue({ shell: '   ' } as ReturnType<typeof userInfo>)

    const resolved = resolveLocalShell({ cwd: '/repo' }, {})

    expect(resolved).toEqual({ command: '/bin/sh', args: ['-l'] })
  })

  test('falls back to /bin/sh when neither env.SHELL nor userInfo().shell is available', () => {
    vi.mocked(userInfo).mockImplementation(() => {
      throw new Error('userInfo unavailable')
    })

    const resolved = resolveLocalShell({ cwd: '/repo' }, {})

    expect(resolved).toEqual({ command: '/bin/sh', args: ['-l'] })
  })
})
