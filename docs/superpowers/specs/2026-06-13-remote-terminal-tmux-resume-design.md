# Remote Terminal Tmux Resume Design

## Goal

Goblin-managed remote terminal tabs should support multiple independent tmux-backed sessions per remote worktree. Each Goblin terminal tab maps to one stable remote tmux session, so users can close a tab, reopen the same numbered terminal later, and resume the same remote shell state.

External remote terminal actions should keep using plain SSH only. Opening a remote worktree in macOS Terminal or Ghostty should SSH to the host, change into the worktree, and start the login shell without tmux.

If tmux is not installed on the remote host, Goblin-managed remote terminals should fall back to the existing SSH login shell behavior.

## Scope

In scope:

- Goblin-managed remote interactive terminal sessions.
- Multiple independent tmux sessions per remote worktree.
- Stable tmux session identity per resolved remote endpoint, remote repository path, remote worktree path, and terminal number.
- Terminal numbers as positive integers starting at `1`.
- Reusing the smallest available terminal number when creating a new terminal.
- Closing a Goblin terminal tab as detach semantics: close the local SSH/PTY, but do not kill the remote tmux session.
- Plain SSH behavior for external remote terminal actions.
- Existing structured errors for invalid input, SSH config changes, unavailable local terminal apps, unsupported terminal backends, and launch failures.

Out of scope:

- Remote Git snapshot, status, fetch, pull, push, and worktree commands.
- Long-lived tmux workers for background repository operations.
- User-facing tmux session management UI.
- Killing or cleaning up remote tmux sessions.
- Installing tmux or changing remote host configuration.
- Attaching to arbitrary user-selected tmux sessions.
- Persisting local terminal process state beyond the existing terminal session model.

## Architecture

Keep tmux inside the Goblin-managed remote terminal boundary.

The existing remote repository Git communication remains owned by `runRemoteCommand()` and continues to execute native SSH commands. External remote terminal actions also remain plain SSH. This avoids coupling non-interactive Git operations or external terminal windows to tmux session state, scrollback, shell profiles, or user-attached panes.

The remote terminal command helpers should expose two explicit invocation builders:

- Managed remote terminal invocation: used by `TerminalCatalog.ensureRemote()` for Goblin in-app terminal tabs. This uses tmux when available.
- External remote terminal invocation: used by `/api/remote/open-terminal` and local terminal backends. This uses SSH plus a login shell only, with no tmux detection or tmux session name.

Local terminal backends should launch prepared command/argument shapes. They should not duplicate remote shell construction or tmux identity logic.

## Terminal Numbering

Goblin already models terminal sessions by `repoRoot + worktreePath + terminalId`, where `terminalId` is formatted as values such as `terminal-1` and `terminal-2`.

For tmux identity, use the numeric part as `terminalNumber`:

```text
terminal-1 -> 1
terminal-2 -> 2
```

`terminalNumber` must be a positive integer starting at `1`. Display labels and existing session keys may continue using `terminal-<number>`, but remote tmux identity should use the numeric value, not the formatted display string.

When creating an additional terminal, Goblin should choose the smallest missing positive number for the worktree. For example:

- Existing open terminals: `1`, `2`; new terminal: `3`.
- Existing open terminals: `2`; new terminal: `1`.
- Existing open terminals: none; new terminal: `1`.

This makes detached tmux sessions naturally reachable again without a separate session management UI.

## Tmux Session Identity

The tmux session name is deterministic for:

```text
user@host:port + "\0" + remote repository path + "\0" + remote worktree path + "\0" + terminal number
```

The remote endpoint identity uses the resolved SSH target, not the SSH config alias:

- `user`: resolved SSH user.
- `host`: resolved `HostName`, falling back to the alias only when SSH resolution already reports that as the effective host.
- `port`: resolved SSH port, defaulting to `22`.

The SSH connection still uses the configured alias. Only the tmux hash input avoids alias dependence. This means renaming an SSH config alias does not lose the tmux session as long as it resolves to the same `user@host:port`.

The session name should not embed raw paths or remote identity text. It should be a short safe identifier:

```text
goblin-<sha256-first-24-hex-chars>
```

The generated session name must use only characters that are safe for tmux session names and shell arguments.

## Remote Terminal Semantics

Managed remote terminal SSH should run a remote shell script equivalent to:

```sh
cd '<remote-worktree-path>' || exit
if command -v tmux >/dev/null 2>&1; then
  exec tmux new-session -A -s '<session-name>' -c '<remote-worktree-path>'
fi
exec "${SHELL:-/bin/sh}" -l
```

Requirements:

- SSH still connects through the configured SSH alias.
- The worktree path must be an absolute remote path and must not contain control characters.
- The remote path and tmux session name must be shell-quoted by shared helper code.
- `cd` happens before tmux so invalid or removed worktrees fail visibly.
- Missing tmux is not an error.
- tmux attach/create failure remains visible in the terminal instead of silently falling back, because fallback would hide that resume semantics were not active.

External remote terminal SSH should run a remote shell script equivalent to:

```sh
cd '<remote-worktree-path>' || exit
exec "${SHELL:-/bin/sh}" -l
```

External remote terminal invocation must not include tmux detection, tmux session names, or tmux commands.

## Lifecycle

Opening a managed remote terminal:

1. The user opens the terminal panel or clicks `+` for a remote worktree.
2. Goblin chooses the terminal number.
3. `TerminalCatalog.ensureRemote()` resolves the SSH config target.
4. The managed invocation builder generates the tmux-aware SSH command using the resolved `user@host:port`, remote repo path, remote worktree path, and terminal number.
5. The terminal session manager starts the local PTY running SSH.
6. SSH attaches to or creates the matching remote tmux session.

Closing a Goblin terminal tab:

1. Goblin closes the local terminal session and SSH/PTY.
2. Goblin does not execute `tmux kill-session`.
3. The remote tmux session remains available on the remote host.

Reopening a detached terminal:

1. Goblin chooses the smallest available terminal number.
2. If that number has a detached tmux session on the remote host, the same deterministic session name attaches to it.
3. If no remote tmux session exists for that number, tmux creates it.

Restarting a Goblin terminal:

1. Goblin keeps the same terminal key and terminal number.
2. The local SSH/PTY is restarted.
3. The managed invocation attaches to the same remote tmux session name.

## Data Flow

Goblin-managed remote terminal:

1. `TerminalTabs` invokes `createTerminal()` for the selected remote worktree.
2. The frontend sends `terminalBridge.create({ repoRoot, branch, worktreePath, kind })`.
3. `TerminalCatalog.create()` selects `terminal-1` for primary sessions or the smallest missing terminal id for additional sessions.
4. `TerminalCatalog.ensureRemote()` parses the terminal id into `terminalNumber`.
5. It resolves the saved remote repo id through SSH config.
6. It calls the managed remote terminal invocation builder.
7. The session manager starts the PTY with the returned SSH command and args.

External remote terminal branch action:

1. The user chooses `Terminal` on a remote branch with a worktree.
2. `useBranchActions.openTerminal()` calls `openRemoteRepositoryTerminal(repo.id, worktreePath)`.
3. The server validates `repoId` and `worktreePath`.
4. The server re-resolves the SSH config alias from the remote repo id.
5. The server builds the external plain-SSH invocation.
6. The selected local terminal backend launches that invocation.

Remote Git data paths are unchanged and continue to call `runRemoteCommand()`.

## Error Handling

Use existing result shapes and messages where possible:

- `error.invalid-arguments` for invalid remote repo ids, invalid terminal inputs, invalid terminal numbers, or invalid remote terminal invocations.
- `error.invalid-path` for invalid remote worktree paths where the caller already uses path-specific errors.
- `error.ssh-config-changed` when the saved remote repo id no longer resolves through SSH config.
- `error.terminal-not-installed` when the configured local terminal app cannot be found.
- `error.remote-terminal-not-supported` when a local terminal backend cannot launch remote commands.

Terminal-visible remote failures should remain visible inside the terminal process:

- Missing tmux falls back to a native SSH login shell for managed remote terminals.
- Failed `cd` exits or prints the shell error.
- Failed tmux attach/create prints the tmux error and exits.

No error path should mutate repository state or kill remote tmux sessions.

## Testing

Focused coverage should include:

- Stable tmux session names for identical `user@host:port`, repo path, worktree path, and terminal number.
- Different tmux session names for different users, hosts, ports, repo paths, worktree paths, or terminal numbers.
- Different SSH aliases that resolve to the same `user@host:port` generate the same tmux session name.
- Session names contain only safe characters and remain short.
- Managed remote terminal invocation uses a tmux-first script with native shell fallback.
- External remote terminal invocation does not contain `tmux`.
- Remote paths with spaces, quotes, and non-ASCII characters are shell-quoted correctly.
- `TerminalCatalog.ensureRemote()` passes the parsed terminal number to the managed invocation builder.
- Additional terminal creation reuses the smallest missing positive terminal number.
- Closing `terminal-1` while `terminal-2` remains open allows the next new terminal to reuse `terminal-1`.
- Native local terminal behavior remains unchanged.
- Remote Git command tests remain unchanged and do not route through tmux.

## Verification

Run:

```bash
bun run test src/system/remote-terminal.test.ts src/system/ssh/commands.test.ts src/system/terminals.test.ts src/server/terminal/terminal.test.ts
bun run typecheck
bun run check:architecture
```

Manual verification:

1. Open a saved remote repository whose host has tmux installed.
2. Open Goblin-managed `terminal-1` and `terminal-2` for the same remote worktree.
3. Leave distinct shell state in each terminal.
4. Close `terminal-1`.
5. Click `+` and confirm Goblin reopens terminal number `1`.
6. Confirm it reconnects to the original `terminal-1` tmux session, while `terminal-2` remains separate.
7. Repeat against a remote host without tmux and confirm managed terminals fall back to normal SSH login shells in the worktree.
8. Use the remote branch action to open an external Terminal or Ghostty window and confirm it opens a plain SSH login shell in the worktree without tmux.
