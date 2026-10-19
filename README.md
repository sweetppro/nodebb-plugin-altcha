# nodebb-plugin-altcha

**ALTCHA proof-of-work CAPTCHA for NodeBB registration.**

Protects NodeBB's standard registration flow using [ALTCHA](https://altcha.org/), a proof-of-work CAPTCHA that helps prevent automated signups without relying on image-based challenges or third-party CAPTCHA services.

## Features

- **Self-hosted widget** — serves the ALTCHA widget from the installed npm dependency when available.
- **Proof-of-work challenges** — generates challenges using PBKDF2/SHA-256.
- **No additional secrets to configure** — derives HMAC secrets from NodeBB's existing `secret` configuration value.
- **Efficient server-side verification** — uses HMAC signatures to validate solutions without performing another PBKDF2 derivation for each registration attempt.
- **Single-use challenges** — prevents replaying successfully verified challenges, including across NodeBB processes.
- **Rate limiting** — limits requests to the challenge endpoint.
- **Configurable difficulty** — adjust proof-of-work cost, counter range, expiry, and automatic verification behavior.

## Installation

From your NodeBB installation directory, install the plugin:

```bash
npm install https://github.com/sweetppro/nodebb-plugin-altcha
```

Then:

1. Open the NodeBB Admin Control Panel (ACP).
2. Navigate to **Plugins** and activate **ALTCHA**.
3. Build the assets and restart NodeBB:

   ```bash
   ./nodebb build && ./nodebb restart
   ```

## Configuration

Open **ACP → Plugins → ALTCHA** to configure the plugin.

| Setting | Description |
|---|---|
| PBKDF2 cost | PBKDF2 work factor used to generate the challenge. |
| Counter min | Minimum counter value for generated challenges. |
| Counter max | Maximum counter value for generated challenges. |
| Challenge lifetime | Challenge validity period in seconds. |
| Start verification | Controls whether the widget automatically verifies on focus, on load, or only when explicitly requested. |
| Widget script URL | Optional override for the widget JavaScript URL. Leave empty to use the locally served widget when available. |
| Abuse limits | Maximum challenge requests allowed per IP during the rate-limit window. |

### Secrets

No additional secrets need to be configured.

The plugin derives two separate HMAC secrets from the `secret` value in NodeBB's `config.json`. These derived secrets are stable across NodeBB processes, allowing challenges to be generated and verified consistently in a multi-process deployment.

Rotating NodeBB's `secret` invalidates challenges issued under the previous secret. Users may need to retry registration.

## How it works

### Challenge generation

When the widget requests a challenge, the plugin generates a PBKDF2/SHA-256 challenge using the configured cost and counter range.

The challenge includes HMAC signatures that allow the server to validate its authenticity and verify the solution efficiently.

### Efficient verification

The plugin uses deterministic challenge generation with key signatures. During registration, the server validates the challenge and its solution using HMAC checks rather than performing another PBKDF2 derivation.

This makes invalid registration attempts relatively inexpensive to reject, reducing the computational impact of floods of bad registrations.

### Single-use challenges

Successfully verified challenges are marked as used in the NodeBB database.

The plugin uses an atomic `incrObjectField` operation to ensure that a challenge cannot be accepted more than once, even when requests are handled by different NodeBB processes.

Replay identifiers are recorded **only after successful verification**, following the hardening introduced in `altcha-lib` v2.6.0:

[altcha-lib v2.6.0 release notes](https://github.com/altcha-org/altcha-lib/releases/tag/v2.6.0)

A challenge is consumed once verification succeeds. This means a subsequent registration failure—for example, because the requested username is already taken—still burns the challenge.

To handle this, the client script resets the widget after every `/register` response so the user can retry with a fresh challenge.

### Registration click handling

NodeBB submits registration through a click handler using `ajaxSubmit`. As a result, the widget's own submit-time automatic verification does not reliably trigger the required registration flow.

The plugin's client script handles this by:

1. Intercepting the Register button click.
2. Checking whether ALTCHA has already verified the challenge.
3. If necessary, initiating verification and waiting for it to complete.
4. Waiting for the hidden challenge payload to become available.
5. Replaying the Register button click so NodeBB's normal registration handler can proceed.

This preserves NodeBB's existing registration submission flow while ensuring that ALTCHA verification happens first.

## Difficulty tuning

The default difficulty settings are starting points, not universal recommendations:

| Setting | Default |
|---|---:|
| PBKDF2 cost | `2000` |
| Counter min | `1000` |
| Counter max | `3000` |
| Challenge lifetime | `600` seconds |
| Abuse limits | `30` requests per IP per 10 minutes |

These values are intended as a starting guess for a few seconds of work on a typical machine, but actual performance varies considerably by device and browser.

**Test on mobile phones as well as desktop computers.** Adjust the cost and counter range based on measured performance and the level of protection you need.

Higher difficulty increases the computational work required from clients. Excessive settings can make registration frustrating or impractical on slower devices.

## Limitations

- **Standard registrations only.** SSO signups, accounts created by administrators, and login attempts are not gated by this plugin.
- **Per-process rate limiting.** The challenge endpoint's rate limiter is held in memory. Its counters are not shared between NodeBB processes, and they reset when a process restarts.
- **Challenge consumption.** Once a challenge has been successfully verified, it cannot be reused. A later registration failure requires a fresh challenge.
- **Device performance.** Proof-of-work duration varies by hardware and browser, so difficulty settings should be tested on representative devices.

## Dependencies

- [ALTCHA](https://github.com/altcha-org/altcha) — browser widget.
- [altcha-lib](https://github.com/altcha-org/altcha-lib) — challenge generation and verification.

## License

MIT
