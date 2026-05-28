import { describe, expect, test } from 'vitest'
import {
  buildRemoteConnectionInput,
  canSubmitRemoteRepository,
  parseRemotePort,
  remotePathError,
} from '#/renderer/components/AddRemoteRepositoryDialog.tsx'
import { diagnosticCategoryMessage } from '#/renderer/components/RemoteDiagnosticsPanel.tsx'

describe('AddRemoteRepositoryDialog helpers', () => {
  test('validates manual mode and remote path before RPC calls', () => {
    expect(parseRemotePort('').error).toBeNull()
    expect(parseRemotePort('2222')).toEqual({ port: 2222, error: null })
    expect(parseRemotePort('65536').error).toBe('remote.port-invalid')
    expect(remotePathError('srv/goblin')).toBe('remote.path-absolute-required')
    expect(remotePathError('/srv/goblin')).toBeNull()

    expect(
      canSubmitRemoteRepository({
        mode: 'manual',
        alias: '',
        host: 'prod',
        user: 'deploy',
        remotePath: '/srv/goblin',
        portError: null,
        pending: false,
      }),
    ).toBe(true)
  })

  test('does not require successful diagnostics before add stays available', () => {
    expect(
      canSubmitRemoteRepository({
        mode: 'config',
        alias: 'prod',
        host: '',
        user: '',
        remotePath: '/srv/goblin',
        portError: null,
        pending: false,
      }),
    ).toBe(true)
  })

  test('builds remote connection input with optional identity files', () => {
    expect(
      buildRemoteConnectionInput(
        'manual',
        '',
        'prod.example.com',
        'deploy',
        22,
        '/srv/goblin',
        '~/.ssh/prod_ed25519',
      ),
    ).toEqual({
      mode: 'manual',
      host: 'prod.example.com',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/goblin',
      identityFile: '~/.ssh/prod_ed25519',
    })

    expect(buildRemoteConnectionInput('config', 'prod', '', '', undefined, '/srv/goblin', '')).toEqual({
      mode: 'config',
      alias: 'prod',
      remotePath: '/srv/goblin',
    })
  })

  test('uses UI-spec diagnostic copy for host key and auth failures', () => {
    expect(diagnosticCategoryMessage('host key')).toBe(
      'Host key verification failed. Confirm the host in your system SSH setup, then retry.',
    )
    expect(diagnosticCategoryMessage('auth failed')).toContain('Authentication failed')
  })
})
