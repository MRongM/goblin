export interface AppQuitEvent {
  preventDefault(): void
}

export interface ShutdownApp {
  on(eventName: 'before-quit', listener: (event: AppQuitEvent) => void): unknown
  on(eventName: 'will-quit', listener: () => void): unknown
  exit(exitCode?: number): void
}

export interface AppShutdownDeps {
  flushSettings: () => Promise<boolean>
  shutdownTerminalSessions: () => Promise<void>
  cleanupPortForwards: () => Promise<void>
  unregisterAppShortcuts: () => void
}

export function wireAppShutdown(app: ShutdownApp, deps: AppShutdownDeps): void {
  let shortcutsUnregistered = false
  const unregisterShortcutsOnce = (): void => {
    if (shortcutsUnregistered) return
    shortcutsUnregistered = true
    try {
      deps.unregisterAppShortcuts()
    } catch (err) {
      console.error('[shortcuts] unregister failed before quit', err)
    }
  }

  app.on('will-quit', unregisterShortcutsOnce)

  let isQuitting = false
  app.on('before-quit', (event) => {
    event.preventDefault()
    if (isQuitting) return
    isQuitting = true

    void runQuitCleanup(deps, unregisterShortcutsOnce).finally(() => {
      app.exit(0)
    })
  })
}

async function runQuitCleanup(deps: AppShutdownDeps, unregisterShortcutsOnce: () => void): Promise<void> {
  unregisterShortcutsOnce()
  const [settings, terminals, portForwards] = await Promise.allSettled([
    deps.flushSettings(),
    deps.shutdownTerminalSessions(),
    deps.cleanupPortForwards(),
  ])

  if (settings.status === 'fulfilled' && !settings.value) console.error('[settings] final flush failed before quit')
  if (settings.status === 'rejected') console.error('[settings] final flush failed before quit', settings.reason)
  if (terminals.status === 'rejected') console.error('[terminal] shutdown failed before quit', terminals.reason)
  if (portForwards.status === 'rejected') console.error('[remote-ports] shutdown failed before quit', portForwards.reason)
}
