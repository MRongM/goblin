import { app } from 'electron'
import { createMainWindow, getMainWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { loadSettings, flushSettings } from '#/main/settings.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { shutdownTerminalSessions } from '#/main/terminal-core.ts'
import { remotePortForwardManager } from '#/main/ssh/port-forward.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'
import { wireAppShutdown } from '#/main/app-shutdown.ts'

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else {
      void createMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!getMainWindow()) void createMainWindow()
  })

  wireAppShutdown(app, {
    flushSettings,
    shutdownTerminalSessions,
    cleanupPortForwards: () => remotePortForwardManager.cleanupAll(),
    unregisterAppShortcuts,
  })

  await app.whenReady()

  // Settings before theme — initTheme reads the persisted pref.
  const settings = await loadSettings()
  await initTheme()

  // Resolve language BEFORE buildMenu — every menu label runs through
  // `t()` and would otherwise render in the default ('en') for the
  // first frame.
  assertDictionaryParity(!app.isPackaged)
  setCurrentLang(resolveLang(settings.lang))

  wireRpcIpc()
  wireTerminalIpc()

  buildAppMenu()
  syncGlobalShortcuts(settings.shortcutsDisabled, settings.globalShortcut)

  await createMainWindow()
}

void main()
