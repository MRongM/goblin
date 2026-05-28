import { describe, expect, test, vi } from 'vitest'
import { wireAppShutdown } from '#/main/app-shutdown.ts'

type Listener = (...args: any[]) => void

describe('app shutdown', () => {
  test('waits for async cleanup before exiting from before-quit', async () => {
    const listeners = new Map<string, Listener>()
    const app = {
      on: vi.fn((eventName: string, listener: Listener) => {
        listeners.set(eventName, listener)
      }),
      exit: vi.fn(),
    }
    const settings = deferred<boolean>()
    const terminals = deferred<void>()
    const portForwards = deferred<void>()

    wireAppShutdown(app, {
      flushSettings: vi.fn(() => settings.promise),
      shutdownTerminalSessions: vi.fn(() => terminals.promise),
      cleanupPortForwards: vi.fn(() => portForwards.promise),
      unregisterAppShortcuts: vi.fn(),
    })

    const event = { preventDefault: vi.fn() }
    listeners.get('before-quit')?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(app.exit).not.toHaveBeenCalled()

    settings.resolve(true)
    terminals.resolve()
    await flushPromises()
    expect(app.exit).not.toHaveBeenCalled()

    portForwards.resolve()
    await flushPromises()
    expect(app.exit).toHaveBeenCalledWith(0)
  })

  test('unregisters shortcuts on will-quit', () => {
    const listeners = new Map<string, Listener>()
    const unregisterAppShortcuts = vi.fn()
    const app = {
      on: vi.fn((eventName: string, listener: Listener) => {
        listeners.set(eventName, listener)
      }),
      exit: vi.fn(),
    }

    wireAppShutdown(app, {
      flushSettings: vi.fn(async () => true),
      shutdownTerminalSessions: vi.fn(async () => {}),
      cleanupPortForwards: vi.fn(async () => {}),
      unregisterAppShortcuts,
    })

    listeners.get('will-quit')?.()

    expect(unregisterAppShortcuts).toHaveBeenCalledTimes(1)
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
