# pi-pulse

A focused [Pi Coding Agent](https://pi.dev) package with two lightweight status extensions:

- **Subscription usage** — provider quota, reset countdowns, and DeepSeek balance/peak pricing.
- **Live throughput** — streaming decode speed, final token rate, TTFT, and input/cache details.

Discord Rich Presence is intentionally not included.

## Features

### Subscription usage

Supported providers:

- OpenAI Codex: 5-hour and weekly quota windows, plus banked resets
- Antigravity Pro: Gemini and third-party model quota windows
- OpenCode Go: rolling, weekly, and monthly limits
- DeepSeek API: account balance and local peak/off-peak timing

The extension uses a shared cache, refreshes around quota resets, coalesces overlapping requests, rejects stale results, and retries temporary failures with exponential backoff.

Commands:

```text
/usage
/usage toggle [bars|percent|off]
/usage refresh [all|active|<provider>]
```

### Live throughput

The footer displays a compact decode-rate reading:

```text
⚡ ~42.1 tok/s
⚡ 39.8 tok/s
```

Live values use a `characters / 4` estimate. When the provider reports output usage, the settled value uses the reported token count. `/throughput` also shows TTFT, uncached/cached input, decode duration, and measurement freshness.

Commands:

```text
/throughput
/throughput toggle [on|off]
/throughput help
```

## Install

From GitHub after the repository is published:

```bash
pi install git:github.com/zhugez/pi-pulse
```

For local development:

```bash
pi install /home/dev/pi-pulse
```

Reload an active Pi session with:

```text
/reload
```

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run check
```

## Security and privacy

Pi extensions execute with the same operating-system permissions as Pi. The usage extension reads relevant credentials from environment variables or `~/.pi/agent/auth.json` and sends them only to the corresponding provider quota/balance endpoints. Review the source before installation.

Runtime state is stored under `~/.pi/agent/`:

- `subscription-usage-cache.json`
- `subscription-usage-prefs.json`
- `live-throughput-prefs.json`

## Attribution

Derived from [Th1nhNg0/pi-extensions](https://github.com/Th1nhNg0/pi-extensions), used under the MIT License. See [NOTICE](NOTICE).

## License

MIT
