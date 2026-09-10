# Privacy

Quota Float is a local-first desktop utility. It reads the existing Codex
Desktop login state only to request quota data, keeps the useful display state
on the device, and does not operate a project-owned proxy or analytics service.

This notice covers the Tauri desktop app. The browser preview uses mock data and
does not read a Codex login file or request live quota data.

## Data flow at a glance

| Activity | Data used | Destination or persistence |
| --- | --- | --- |
| Find the Codex login | The path is resolved from `CODEX_HOME`, or from the user's `.codex` directory when that variable is not set | Read locally by the desktop process |
| Build quota requests | Access token and optional ChatGPT account identifier | Sent over HTTPS to the two quota endpoints listed below; retained only for the request lifecycle |
| Parse the response | Plan, quota windows, reset times, reset-credit count, and expiration times | Held in app memory for display; raw responses are not written to disk |
| Update check | Public release metadata and, after confirmation on Windows, the signed update artifact | GitHub Releases; no Codex credential is sent to the updater endpoint |
| Save preferences | Widget behavior and appearance choices | Local Tauri application config directory |
| Save quota-radar history | Timestamp, provider, status, and remaining percentages | Local filtered JSON history; never uploaded by Quota Float |

## What the app reads

The desktop process reads one local authentication file:

- `CODEX_HOME/auth.json` when `CODEX_HOME` is configured; or
- the user's `.codex/auth.json` as the fallback path.

The file is limited to 256 KB. Quota Float uses the access token and, when
available, an account identifier from the file. If the account identifier is
not present, it may read the corresponding identifier claim from the token
payload. The token payload is parsed locally; no separate token-introspection
request is made.

The app does not search the rest of the user's files for credentials.

## What the app sends

### Quota requests

The existing access token is used as a bearer token for these HTTPS endpoints:

```text
https://chatgpt.com/backend-api/wham/usage
https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
```

The request may also include the account identifier in the header expected by
the quota service. Quota requests use the desktop process, do not follow
redirects, and cap response bodies at 1 MB.

### Update requests

The Tauri updater may check the configured GitHub Releases metadata endpoint:

```text
https://github.com/change-42-yhmm/quota-float/releases/latest/download/latest.json
```

If an update is available, Windows asks for confirmation before downloading and
installing it. On macOS, confirmation opens the GitHub release page so the user
can download the appropriate bundle. GitHub and the quota service may receive
ordinary network metadata such as an IP address under their own policies; this
is not Quota Float telemetry.

Quota Float does not send prompts, chat history, local file contents, or raw
quota responses to a Quota Float-owned service. The access token and optional
account identifier are sent only to the ChatGPT quota endpoints described
above, as required for the quota request.

## What is stored locally

### Widget preferences

The app stores these settings in its Tauri application config directory:

- click-through lock state;
- always-on-top state;
- persistent expansion state;
- pinned provider and rotation interval;
- language and appearance; and
- widget opacity.

### Native window state

The Tauri window-state plugin stores the widget and settings-window geometry,
including position and size, in the same local config area. This data is used to
restore the windows on the next launch.

### Quota-radar history

The radar history contains only successful snapshots with:

- provider name;
- capture timestamp;
- success status; and
- 5-hour and weekly remaining percentages, when available.

History is sampled at no more than one persisted point per provider per minute,
pruned to the most recent 30 days, and capped at 20,000 points. The in-app
clear action removes the active history used by the radar. Settings and history
are written atomically, so temporary `.tmp` and backup `.bak` files may exist
locally while files are being replaced; remove the app config directory after
exiting the app if a complete local-data deletion is required.

Quota Float does not persist:

- Codex access tokens or account identifiers;
- plan names, reset-credit metadata, or raw quota responses;
- user prompts, chat history, or local file contents; or
- the path of the Codex authentication file or arbitrary personal file paths.

The Codex login file itself remains owned and managed by Codex Desktop. Quota
Float does not delete, modify, or upload it.

## Permissions and services

The desktop app needs only the capabilities required to:

- read the local authentication file and write its own app config;
- make the quota HTTPS requests and check GitHub Releases for updates;
- create and control its floating windows and tray icon;
- optionally register for start-at-login; and
- restart itself after a confirmed Windows update.

The current app does not include telemetry, analytics, crash reporting,
advertising, or third-party tracking. It does not redeem reset credits or change
Codex account settings.

## Logging and issue reports

Runtime logs are intentionally generic. They must not contain access tokens,
account identifiers, raw responses, request headers, authentication paths, or
personal file paths.

When reporting a problem, redact sensitive values before sharing logs, network
responses, screenshots, or configuration files. Do not open a public issue with
credentials or account data. See [SECURITY.md](SECURITY.md) for the reporting
boundary.

## Accuracy and retention boundaries

Quota Float displays quota windows returned by the Codex quota service. That
service is not a stable public contract; if authentication or response fields
change, the app shows a signed-out, unavailable, or stale state rather than
guessing.

The quota radar derives only a percentage trend from multiple local snapshots.
It does not measure token usage, determine billing, or predict the service's
actual consumption behavior. Reset credits are read-only: the app can display a
count and expiration times when available, but it cannot redeem them.

For the implementation's current platform and endpoint caveats, see
[docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md).
