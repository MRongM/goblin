# Windows Adaptation Design

## Goal

Goblin must be a native, dependable Windows 11 application. A user can install
and launch the packaged app, open an integrated terminal rooted at the selected
workspace, run `codex`, interact with its full-screen TUI, and continue using
the PowerShell session after Codex exits.

The Windows terminal is a general terminal. Goblin does not own Codex login,
configuration, model selection, conversation state, or recovery.

## Product behavior

- A new local terminal on Windows starts Windows PowerShell with its normal user
  profile and without the startup banner.
- Explicit process overrides remain authoritative. A caller that supplies a
  command and arguments gets exactly that process rather than the default
  PowerShell policy.
- A terminal startup command runs through PowerShell and leaves the interactive
  PowerShell session open after the command finishes.
- Terminal input, resize, output, process exit, and reconnect continue through
  the existing node-pty/ConPTY and realtime session boundaries.
- Interactive terminal applications such as Codex use the existing xterm
  surface. There is no Codex-specific button, route, IPC procedure, protocol,
  state, or fallback.
- If PowerShell cannot be spawned, terminal creation fails through the existing
  actionable terminal error path. Goblin does not silently switch shells.
- If `codex` is missing, unauthenticated, offline, or exits with an error,
  PowerShell and Codex present that result in the terminal. Goblin does not
  report a fabricated success or retry the command.

## Shell ownership

The server terminal feature owns local shell policy. On Windows, the canonical
default is `powershell.exe` with `-NoLogo`. Windows PowerShell is part of the
supported Windows 11 platform, so `cmd.exe` is not retained as a compatibility
path.

Startup commands use the same shell owner with PowerShell's `-NoExit -Command`
contract. This preserves one shell policy for ordinary and startup-command
sessions. Unix shell selection and login behavior remain unchanged.

Platform selection is an explicit input to the pure shell-policy function, with
the host platform as its production default. This makes both Windows and Unix
contracts testable on every development host without mutating global platform
state.

## Windows test portability

The test suite must distinguish product behavior from host-specific test
assumptions.

- Shared repository fixtures construct native absolute paths and workspace
  locators from one canonical helper. Tests do not encode `/tmp` as a valid
  Windows path.
- Assertions compare the authoritative representation for the boundary under
  test. Filesystem assertions use native paths; protocol tests use the protocol's
  canonical serialized form.
- POSIX-only behavior such as Unix permission bits, Unix sockets, and execution
  by a POSIX shell is declared platform-specific. A Windows equivalent is added
  when Goblin promises equivalent behavior; otherwise the POSIX-only test is
  gated at declaration time.
- Remote SSH command text remains a POSIX remote-shell contract even when the
  client runs on Windows. Tests validate command construction without asking a
  Windows local process launcher to interpret multiline POSIX arguments.
- Terminal PTY tests cover both shell-resolution policies deterministically.
  A Windows integration smoke test exercises PowerShell through ConPTY without
  depending on network access or a user's Codex account.

Tests remain privacy-safe and run through `bun run test` only.

## Packaging

Windows release builds use the node-pty win32 prebuilds already pinned in the
installed dependency tree. The build verifies the required x64 and arm64 files
before packaging and disables electron-builder's native dependency rebuild for
the Windows targets. A normal Windows release build therefore does not require
Python, Visual Studio Build Tools, or a local node-gyp toolchain.

The alternative package mirror remains an explicit network choice. It is not a
runtime fallback and does not change the produced application. Packaging keeps
the existing per-user NSIS behavior and produces both x64 and arm64 installers.

## Data and control flow

1. The user opens a terminal for a workspace target.
2. The existing terminal application admits a logical session and resolves the
   target's authoritative execution path.
3. The PTY runtime resolves the Windows shell policy to PowerShell, then spawns
   it through ConPTY at the fitted xterm geometry.
4. Browser input and resize messages flow through the existing realtime
   terminal protocol; output flows back into the existing xterm projection.
5. The user types `codex`. PowerShell resolves the user's installed command and
   Codex owns the TUI conversation until it exits.
6. The original PowerShell process remains the session owner and resumes the
   prompt after Codex exits.

No second authority or application-level synchronization is introduced.

## Acceptance criteria

- `bun run typecheck` passes on Windows.
- `bun run test` passes on Windows without bypassing the repository test
  configuration.
- A normal `bun run build` on Windows packages x64 and arm64 NSIS installers
  without requiring Python or compiling node-pty from source.
- Packaged server resources include the required Windows node-pty binaries.
- On Windows 11, a terminal opened from a workspace starts at a PowerShell
  prompt in the authoritative workspace path.
- In the packaged app, entering `codex` opens the Codex TUI; keyboard input,
  viewport resizing, streaming output, and exit back to PowerShell work.
- An authenticated manual prompt receives a response in the Codex TUI. Missing
  Codex or authentication is visibly reported by the owning command rather than
  converted into application success.

## Non-goals

- Installing or updating Codex.
- Embedding a separate Codex chat UI.
- Adding a Codex launch button or automatically running Codex.
- Adding a shell-profile preference or shell discovery UI.
- Supporting WSL as the local terminal owner.
- Preserving `cmd.exe` as Goblin's default Windows shell.
