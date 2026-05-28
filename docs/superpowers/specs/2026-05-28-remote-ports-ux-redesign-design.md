# Remote Ports UX Redesign Design

## Scope

Improve the UX for already-open remote SSH repositories, focused on the `Ports` toolbar entry and remote port forwarding panel.

Do not change the `Add remote SSH repository` dialog, remote connection resolution, SSH target model, tunnel process lifecycle, or persisted config format.

## Design

The remote toolbar remains dense and repo-focused. The `Ports` button stays near other remote actions and continues to show the running tunnel count.

The ports popover becomes a wider management surface:

- Header shows `Remote ports`, a compact running/total summary, and a scan action.
- Main body uses two columns on normal desktop width.
- Left column contains manual add controls and saved forwarded ports.
- Right column contains discovered listening ports from scan.
- Saved rows emphasize service label/status and URL first, with copy/open/start/stop/remove actions grouped on the right.
- Failed rows keep the saved config visible and show the failure message inline while leaving Start available.
- Empty and scan message states stay inline and non-blocking.

## Behavior

All existing store actions remain unchanged:

- `addRemotePortForward`
- `removeRemotePortForward`
- `startRemotePortForward`
- `stopRemotePortForward`
- `scanRemotePorts`

The renderer still never builds SSH commands. The redesign is presentational and interaction-layout only.

## Tests

Update the existing `RemotePortsPopover.ui.test.tsx` coverage to assert:

- The popover is wider than the previous compact stack and exposes saved/discovered sections.
- Saved port rows keep running URL and requested-port hints visible.
- Manual add still submits the same config payload.
- Long saved lists remain contained in a scrollable popover body.

## Constraints

- Follow existing React, Tailwind, shadcn-style component, lucide icon, and i18n patterns.
- Keep cards/panels compact with existing `rounded-md` radius.
- Avoid new abstractions unless they simplify the component.
- Keep UI copy in sentence case for buttons/actions/headings and lowercase status chips.
