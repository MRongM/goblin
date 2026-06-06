import { describe, expect, test } from 'vitest'
import {
  aiCliBusy,
  detectAiCliExecutionState,
  type AiCliExecutionState,
} from '#/renderer/components/terminal/ai-cli-status.ts'

describe('detectAiCliExecutionState', () => {
  test('detects Codex running from process name', () => {
    const state = detectAiCliExecutionState({ processName: 'codex', chunk: 'thinking\n', previous: null })
    expect(state).toMatchObject({ provider: 'codex', status: 'running' })
  })

  test('detects Claude running from process name', () => {
    const state = detectAiCliExecutionState({ processName: 'claude', chunk: 'Working...\n', previous: null })
    expect(state).toMatchObject({ provider: 'claude', status: 'running' })
  })

  test('detects provider from echoed shell command', () => {
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '$ codex fix terminal status\n', previous: null }),
    ).toMatchObject({ provider: 'codex', status: 'running' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '> claude continue\n', previous: null }),
    ).toMatchObject({ provider: 'claude', status: 'running' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '/usr/local/project/main$ codex run branch\n', previous: null }),
    ).toMatchObject({ provider: 'codex', status: 'running' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '➜ /tmp/goblin on main $ codex cc status\n', previous: null }),
    ).toMatchObject({ provider: 'codex', status: 'running' })
  })

  test('detects provider from wrapper command forms', () => {
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '$ pnpm exec codex fix branch\n', previous: null }),
    ).toMatchObject({ provider: 'codex', status: 'running' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '$ npx claude ask review\n', previous: null }),
    ).toMatchObject({ provider: 'claude', status: 'running' })
  })

  test('maps approval and prompt output to waiting', () => {
    const previous: AiCliExecutionState = { provider: 'codex', status: 'running', updatedAt: 1 }
    expect(
      detectAiCliExecutionState({ processName: 'codex', chunk: 'Allow command? [y/N]\n', previous }),
    ).toMatchObject({ provider: 'codex', status: 'waiting' })
  })

  test('returns waiting when the command appears to have returned to shell prompt', () => {
    const previous: AiCliExecutionState = { provider: 'codex', status: 'running', updatedAt: 1 }
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '\n/usr/local/project/main$ ', previous }),
    ).toMatchObject({ provider: 'codex', status: 'waiting' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '\n➜ /tmp/goblin on main  ', previous }),
    ).toMatchObject({ provider: 'codex', status: 'waiting' })
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: '\n> ', previous }),
    ).toMatchObject({ provider: 'codex', status: 'waiting' })
    expect(
      detectAiCliExecutionState({ processName: 'pwsh', chunk: '\nPS C:\\projects\\app> ', previous }),
    ).toMatchObject({ provider: 'codex', status: 'waiting' })
  })

  test('does not treat regular text ending with a currency symbol as prompt', () => {
    const previous: AiCliExecutionState = { provider: 'codex', status: 'running', updatedAt: 1 }
    expect(
      detectAiCliExecutionState({ processName: 'zsh', chunk: 'final price is $25', previous }),
    ).toMatchObject({ provider: 'codex', status: 'running' })
  })

  test('maps terminal states to non-busy end states', () => {
    const previous: AiCliExecutionState = { provider: 'claude', status: 'running', updatedAt: 1 }
    expect(detectAiCliExecutionState({ processName: 'claude', chunk: 'Done\n', previous })).toMatchObject({
      provider: 'claude',
      status: 'succeeded',
    })
    expect(
      detectAiCliExecutionState({ processName: 'claude', chunk: 'Error: request failed\n', previous }),
    ).toMatchObject({
      provider: 'claude',
      status: 'failed',
    })
    expect(
      detectAiCliExecutionState({ processName: 'claude', chunk: 'Cancelled by user\n', previous }),
    ).toMatchObject({
      provider: 'claude',
      status: 'cancelled',
    })
  })

  test('strips ANSI before matching', () => {
    const state = detectAiCliExecutionState({
      processName: 'codex',
      chunk: '\u001b[32mWaiting for approval\u001b[0m\n',
      previous: { provider: 'codex', status: 'running', updatedAt: 1 },
    })
    expect(state).toMatchObject({ provider: 'codex', status: 'waiting' })
  })

  test('leaves unrelated shell output unclassified', () => {
    expect(detectAiCliExecutionState({ processName: 'zsh', chunk: 'git status\n', previous: null })).toBeNull()
  })

  test('does not revive a completed AI state from unrelated shell output', () => {
    const previous: AiCliExecutionState = { provider: 'codex', status: 'succeeded', updatedAt: 1 }
    expect(detectAiCliExecutionState({ processName: 'zsh', chunk: 'git status\n', previous })).toBe(previous)
  })
})

describe('aiCliBusy', () => {
  test('treats only starting and running as busy', () => {
    expect(aiCliBusy({ provider: 'codex', status: 'starting', updatedAt: 1 })).toBe(true)
    expect(aiCliBusy({ provider: 'codex', status: 'running', updatedAt: 1 })).toBe(true)
    expect(aiCliBusy({ provider: 'codex', status: 'waiting', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy({ provider: 'codex', status: 'succeeded', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy({ provider: 'codex', status: 'failed', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy({ provider: 'codex', status: 'cancelled', updatedAt: 1 })).toBe(false)
    expect(aiCliBusy(null)).toBe(false)
  })
})
