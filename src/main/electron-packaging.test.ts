import { describe, expect, test } from 'vitest'
import {
  defaultSkipElectronDependencyRebuild,
  ELECTRON_SERVER_EXTRA_RESOURCES,
} from '#scripts/electron-packaging.ts'

describe('Electron packaged server layout', () => {
  test('deploys the complete ASAR-unaware server runtime as ordinary resources', () => {
    expect(ELECTRON_SERVER_EXTRA_RESOURCES).toEqual([
      { from: 'dist/server', to: 'dist/server' },
      { from: 'dist/web', to: 'dist/web' },
      { from: 'node_modules/node-pty', to: 'node_modules/node-pty' },
    ])
  })

  test('uses verified prebuilds for Windows release and install packaging', () => {
    expect(defaultSkipElectronDependencyRebuild('win32', false)).toBe(true)
    expect(defaultSkipElectronDependencyRebuild('win32', true)).toBe(true)
  })

  test('keeps release rebuilds for macOS while install mode remains fast', () => {
    expect(defaultSkipElectronDependencyRebuild('darwin', false)).toBe(false)
    expect(defaultSkipElectronDependencyRebuild('darwin', true)).toBe(true)
  })
})
