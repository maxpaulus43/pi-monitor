# pi-monitor

Run commands in the background while continuing your Pi conversation. When a command exits, Pi receives its result and automatically follows up.

## Try it

```sh
pi -e ./index.ts
```

Or install this directory with `pi install /absolute/path/to/pi-monitor`, then reload Pi.

Ask Pi:

> Monitor PR #123's CI. When it finishes, summarize any failures.

Pi can start `gh pr checks 123 --watch` with the `monitor` tool. The command handles polling; the extension listens for output and exit. Monitoring itself uses no model calls. Completion triggers a normal, billable assistant turn. When Pi is busy, the result queues as a follow-up rather than interrupting.

## Controls

- `/monitors` or **Ctrl+Shift+M** opens the live viewer.
- In fullscreen Pi, click the monitor widget to open it.
- **Left/right** switches jobs; **up/down** scrolls output.
- **s** stops a running job; **d** dismisses a finished job; **Escape** closes the viewer.
- The widget hides when no jobs are running. Finished jobs stay in `/monitors` until dismissed. Dismissing the last job closes the viewer; messages already delivered to the conversation remain.

The model-facing `monitor` tool accepts `action: "start" | "status" | "stop"`, plus `command`, an optional `title`, or a job `id`. Status without an ID lists jobs. Cancellation does not trigger an automatic follow-up.

## Scope

- macOS/Linux, tested against Pi 1.4.0.
- Jobs belong to the current session. Quit, reload, or session replacement stops them; jobs are not restored on resume.
- Commands run through `/bin/bash -c` in the session working directory, inherit your environment and permissions, and have no interactive stdin.
- Output is limited to the last 32,768 characters per job. Earlier output is discarded; terminal control sequences are removed before display or model delivery.
- Cancellation sends TERM to the process group, then KILL after 500 ms. Commands that deliberately daemonize into another process group are not supported. A forced Pi crash cannot run cleanup.
- This is not a sandbox. Only run commands you trust. Command output enters the conversation; avoid commands that print secrets. CI commands require your existing `gh` authentication.
- Keep Pi open for automatic follow-ups. Headless one-shot invocations are not a persistent monitor service.

## Tests

```sh
npm test
```

To include the extension integration test against an installed Pi:

```sh
PI_MONITOR_HOST="$(npm root -g)/@earendil-works/pi-coding-agent" npm test
```

Tests cover background completion, errors, bounded output, terminal sanitization, process-group cancellation, shutdown isolation, tool registration, viewer rendering, and automatic follow-up options. No additional runtime dependencies are needed beyond Pi.
