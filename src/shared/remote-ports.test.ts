import { describe, expect, test } from 'vitest'
import {
  formatRemotePortForwardUrl,
  normalizeRemotePortConfigMap,
  normalizeRemotePortForwardConfig,
  normalizeRemotePortForwardConfigs,
  remotePortForwardConfig,
} from '#/shared/remote-ports.ts'

describe('remote port forwarding model', () => {
  test('normalizes valid configs and trims labels', () => {
    expect(
      normalizeRemotePortForwardConfig({
        id: 'cfg-1',
        remotePort: 3000,
        requestedLocalPort: 3001,
        label: ' dev server ',
      }),
    ).toEqual({
      id: 'cfg-1',
      remotePort: 3000,
      requestedLocalPort: 3001,
      label: 'dev server',
    })
  })

  test('rejects invalid ids and ports', () => {
    expect(normalizeRemotePortForwardConfig({ id: '', remotePort: 3000, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'bad\0id', remotePort: 3000, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'cfg', remotePort: 0, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'cfg', remotePort: 65536, requestedLocalPort: null })).toBeNull()
    expect(normalizeRemotePortForwardConfig({ id: 'cfg', remotePort: 3000, requestedLocalPort: 0 })).toBeNull()
  })

  test('normalizes arrays and drops duplicate ids after first valid config', () => {
    expect(
      normalizeRemotePortForwardConfigs([
        { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
        { id: 'cfg-1', remotePort: 4000, requestedLocalPort: null, label: null },
        { id: 'cfg-2', remotePort: 5000, requestedLocalPort: 5001, label: '' },
      ]),
    ).toEqual([
      { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
      { id: 'cfg-2', remotePort: 5000, requestedLocalPort: 5001, label: null },
    ])
  })

  test('normalizes persisted config maps', () => {
    expect(
      normalizeRemotePortConfigMap({
        'ssh://deploy@prod:22/srv/goblin': [
          { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
        ],
        bad: [{ id: 'cfg-2', remotePort: 0, requestedLocalPort: null }],
      }),
    ).toEqual({
      'ssh://deploy@prod:22/srv/goblin': [
        { id: 'cfg-1', remotePort: 3000, requestedLocalPort: null, label: null },
      ],
    })
  })

  test('creates configs and formats local urls', () => {
    const config = remotePortForwardConfig({ id: 'cfg-1', remotePort: 8080, requestedLocalPort: null, label: null })

    expect(config).toEqual({ id: 'cfg-1', remotePort: 8080, requestedLocalPort: null, label: null })
    expect(formatRemotePortForwardUrl({ localHost: '127.0.0.1', actualLocalPort: 49152 })).toBe(
      'http://127.0.0.1:49152',
    )
  })
})
