# Android Worktree Tmux Terminal ID Design

## Summary

Android project/worktree terminals should support multiple independent remote tmux sessions for the same worktree. Goblin should allocate a small local terminal number per project worktree, use that number as part of the deterministic remote tmux session name, and reconnect to the same numbered tmux session when that terminal is reopened.

This design applies only to Android built-in SSH terminals opened from a saved project/worktree. Host or diagnostics temporary terminals stay as plain SSH shells and do not use tmux.

## Goals

- Allow one project worktree to have multiple independent tmux-backed terminals.
- Allocate numeric `terminalId` values from `1`, using the smallest available number for the same remote project worktree.
- Reuse the same `terminalId` when a local record is deleted and the number becomes available.
- Keep `Close` and local record deletion as local-only lifecycle actions. They detach from or remove Goblin state, but do not kill the remote tmux session.
- Reconnect or restart a Goblin terminal record into the same remote tmux session by preserving its `terminalId`.
- Keep SSH alias out of the tmux hash so alias renames do not lose remote session continuity.
- Keep external Termux handoff unchanged.

## Non-Goals

- Do not add a tmux list, kill, cleanup, or session management UI.
- Do not automatically run `tmux kill-session` when closing or deleting a Goblin terminal.
- Do not enable tmux for host/diagnostics temporary terminals.
- Do not change SSH authentication, host-key trust, terminal rendering, input controls, or foreground-service ownership.
- Do not change external Termux commands.

## Current State

The current Android terminal work already has two important pieces:

- The repository terminal panel can create multiple local terminal records for one worktree.
- `SshTerminalStartupCommand` can generate a tmux-first startup script, but the current tmux session name is based on remote authority plus worktree path, so all terminals for the same worktree attach to the same remote tmux session.

`TerminalSessionManager` currently generates a local Goblin session id and a display name such as `terminal-1`. The display name is UI state, not a stable business key. The design should introduce an explicit numeric terminal identity instead of deriving remote behavior from display text.

## Selected Approach

Add an explicit numeric project terminal slot to the terminal record and use it to derive the remote tmux session name.

Project terminal identity has three layers:

1. Goblin local `sessionId`
   - Existing internal id for local records, observers, PTY control, and navigation.
   - It is not used in the remote tmux hash.
2. Numeric `terminalId`
   - Starts at `1`.
   - Scoped to the same parsed SSH authority, repository root path, and worktree path.
   - Displayed as `terminal-$terminalId`.
   - Used as the stable remote tmux slot.
3. Remote tmux session name
   - Deterministic name generated from parsed remote identity, repository path, worktree path, and numeric terminal id.
   - Format: `goblin-<sha256 prefix>`.

This keeps the UI behavior small and predictable while making the remote tmux identity independent from local random session ids and mutable SSH aliases.

## Tmux Name Generation

The tmux hash input is:

```text
user@host:port + "\0" + remoteRepoPath + "\0" + remoteWorktreePath + "\0" + terminalId
```

Rules:

- `user` is the resolved SSH user available in `RemoteTarget.user`. If a future SSH config resolver cannot resolve a user, use a fixed empty-user marker instead of using the SSH alias.
- `host` is the resolved remote host available in `RemoteTarget.host`. Prefer a resolved IP when available, otherwise use the resolved hostname. Do not use SSH alias.
- `port` is the resolved `RemoteTarget.port`, defaulting to `22` at target creation.
- `remoteRepoPath` is the saved project repository root path.
- `remoteWorktreePath` is the selected worktree path.
- `terminalId` is the decimal number text, for example `2`.
- If any of user, host, port, repository path, worktree path, or terminal id differs, the generated tmux name should differ.
- Alias changes must not affect the generated name.

The final name is:

```text
goblin-<first 24 hex chars of sha256(input)>
```

Example conceptual input, with `<NUL>` representing the separator byte:

```text
developer@192.168.1.20:22<NUL>/srv/repo<NUL>/srv/repo-feature<NUL>2
```

Example output:

```text
goblin-a3f19c8d47b2e90f0a12bc34
```

## Data Model

Extend `TerminalSessionRecord` with:

- `terminalId: Int?`
  - Required positive number for project/worktree terminals.
  - When present, it starts at `1`.
  - Null for host/diagnostics temporary terminals.
- `repositoryRemotePath: String?`
  - The saved project repository root path.
  - Non-null only for project/worktree terminals.
  - Null for host/diagnostics temporary terminals.

Keep `displayName` for compatibility, but do not treat it as the source of truth. For project terminals, display name should be derived from `terminalId` as `terminal-$terminalId`. Temporary terminals can keep the existing display behavior and must not use `terminalId` for tmux naming.

Update `TerminalSessionCodec` by appending the new fields and preserving decode support for existing payload shapes. When old records lack `terminalId`, load-time normalization should:

- preserve a parseable `displayName` such as `terminal-2` when possible;
- otherwise assign the smallest available positive number within the same workspace group;
- keep restored running records marked disconnected as they are today.

## Allocation Rules

When creating a project terminal:

1. Build a terminal workspace scope from:
   - parsed SSH authority: `user@host:port`;
   - repository root path;
   - worktree path.
2. Collect existing local records in that scope.
3. Pick the smallest positive integer not already used as `terminalId`.
4. Create the local terminal record with that `terminalId`.
5. Open the remote SSH shell with a startup context containing repository path, worktree path, and terminal id.

Examples:

- Existing local records: `terminalId = 2`. New terminal gets `1`.
- Existing local records: `1`, `2`. New terminal gets `3`.
- Deleting local record `1` releases the local slot. Creating again gets `1` and attaches to the remote tmux session for slot `1` if it still exists.

Allocation is scoped by parsed remote identity, repository path, and worktree path. Different users, hosts, ports, projects, or worktrees do not share numbering.

## Startup Semantics

Introduce a startup context passed from project terminal creation/reconnect into the SSH terminal startup boundary.

Project/worktree terminal:

1. Normalize repository and worktree paths.
2. Generate the tmux session name from resolved user, host, port, repository path, worktree path, and numeric terminal id.
3. Start a shell and inject the tmux-first startup script after PTY allocation.
4. `cd` into the selected worktree.
5. If `tmux` exists, run:

```sh
tmux new-session -A -s "$goblin_tmux_session"
```

6. If tmux exits with status `0`, exit the startup shell normally.
7. If tmux returns a non-zero status, print one short diagnostic and fall back to the user's shell.
8. If tmux is missing, fall back to the user's shell.

Host/diagnostics temporary terminal:

- No project startup context is passed.
- Do not generate a tmux session name.
- Start the existing plain SSH shell behavior.

If `cd` into the worktree fails, do not create tmux from another directory. Let the shell show the path failure and exit or remain failed according to the existing terminal behavior.

## Lifecycle

### New Terminal

Clicking `New terminal` for a project worktree creates a new local record with the smallest available numeric `terminalId`, then attaches to or creates the matching remote tmux session.

### Cross-Client Attach

Android can attach to a tmux session created from another client, including a PC, only when that client used the same deterministic Goblin tmux naming rule and the same numeric terminal id. For example, a PC-created session for the same user, host, port, repository path, worktree path, and `terminalId = 1` will have the same `goblin-<hash>` name, so Android `terminalId = 1` attaches to it.

Android does not discover arbitrary remote tmux sessions in this design. It does not run `tmux list-sessions`, does not decode every existing `goblin-*` session into local rows, and does not show manually named tmux sessions such as `dev` or `server`. Adding remote tmux discovery would be a separate feature because it needs a listing UI, collision handling, and a mapping contract for sessions created outside this Android flow.

### Close

Closing the Goblin terminal tab closes only the local Goblin terminal session and SSH/PTY connection. It does not run `tmux kill-session`. The remote tmux session remains on the server.

### Reopen Same Number

If a local terminal number becomes available and is created again, Goblin computes the same tmux name. If that remote tmux session still exists, `tmux new-session -A` attaches to it. If it does not exist, tmux creates it.

### Reconnect Or Restart

Reconnect keeps the existing local record and `terminalId`, opens a new local SSH/PTY connection, and attaches to the same numbered remote tmux session.

### Delete Local Record

Deleting a Goblin terminal record removes only local state and releases the local number. It does not kill the remote tmux session. This avoids accidentally killing user processes.

## Error Handling

- tmux missing: silently fall back to native shell.
- tmux startup failure: print one concise diagnostic line with the exit status, then fall back to native shell.
- worktree `cd` failure: do not start tmux from the wrong directory.
- startup input write failure: keep the existing startup input failure output path.
- blocked writes and half-open SSH connections: keep existing write timeout and heartbeat behavior.
- stale restored sessions: keep the current behavior of marking attachable sessions disconnected after app restart.

## Testing

Add or update focused JVM tests.

### `TerminalSessionManager`

- Creating project terminals for one workspace assigns `terminalId` values from the smallest available positive integer.
- Deleting local record `1` and creating another terminal reuses `1`.
- Reconnect preserves the existing `terminalId`.
- Numbering is independent across different users, hosts, ports, repository paths, and worktree paths.
- Display names remain `terminal-$terminalId`.

### `SshTerminalStartupCommand`

- Project startup input includes tmux detection and `tmux new-session -A -s`.
- Tmux name uses user, host, port, repository path, worktree path, and numeric terminal id.
- Alias changes do not change the tmux name.
- Different repository paths, worktree paths, or terminal ids generate different names.
- Generated tmux name matches `goblin-[0-9a-f]{24}`.
- Paths with spaces and single quotes are shell-quoted correctly.
- Missing project startup context does not enable tmux.

### `TerminalSessionCodec`

- New fields round-trip through serialized storage.
- Legacy payloads decode successfully.
- Legacy project records get bounded, positive terminal ids during load normalization.

### UI State Helpers

- Terminal title and row labels still show `terminal-1`, `terminal-2`, and so on.
- Workspace and global terminal switching continue to use local Goblin session records.

## Acceptance Criteria

- A project worktree can have `terminal-1`, `terminal-2`, and additional independent tmux-backed terminals.
- If only `terminal-2` exists locally, clicking `New terminal` creates local `terminal-1`.
- Reopening `terminal-1` attaches to the same remote tmux session when it still exists.
- Android can attach to a PC-created tmux session only when the PC used the same Goblin tmux naming rule and the same terminal id.
- Reconnect/restart for a Goblin terminal keeps the same numeric terminal id and remote tmux session.
- Closing or deleting a Goblin terminal record does not kill the remote tmux session.
- Android does not list or import arbitrary remote tmux sessions in this scope.
- Host/diagnostics temporary terminals remain plain SSH shells.
- External Termux handoff behavior is unchanged.
