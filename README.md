# nodebb-plugin-altcha

**ALTCHA proof-of-work CAPTCHA for NodeBB registration, login, and password reset.**

Protects NodeBB's standard registration, login, and password-reset forms using [ALTCHA](https://altcha.org/), a proof-of-work CAPTCHA that helps prevent automated abuse without relying on image-based challenges or third-party CAPTCHA services.

Registration is protected by default. Login and password reset can be turned on separately, each with its own difficulty.

## Features

- **Self-hosted widget** — serves the ALTCHA widget from the installed npm dependency when available.
- **Proof-of-work challenges** — generates challenges using PBKDF2/SHA-256.
- **Per-form settings** — registration, login, and password reset each have their own enable switch, difficulty, lifetime, and abuse limit.
- **No additional secrets to configure** — derives a separate pair of HMAC secrets for each form from NodeBB's existing `secret`.
- **Efficient server-side verification** — uses HMAC signatures to validate solutions without performing another PBKDF2 derivation for each attempt.
- **Single-use challenges** — prevents replaying successfully verified challenges, including across NodeBB processes.
- **Shared rate limiting** — a fixed-window counter per form and per IP, stored in the NodeBB database so it applies across workers.
- **Checkbox verification** — the proof of work starts only when the visitor clicks the ALTCHA checkbox.

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

Open **ACP → Plugins → ALTCHA**. Each form has its own tab. **General** holds the optional widget script URL.

| Setting | Description |
|---|---|
| Require ALTCHA | Turns protection on for that form. Registration defaults to on. Login and password reset default to off. |
| PBKDF2 cost | PBKDF2 work factor used to generate that form's challenge. |
| Counter min | Minimum counter value for generated challenges. |
| Counter max | Maximum counter value for generated challenges. |
| Challenge lifetime | Challenge validity period in seconds. |
| Verification | Runs only when the visitor clicks the ALTCHA checkbox. Submitting, loading, or refreshing the page does not start it. |
| Abuse limit | Maximum challenge requests allowed for that form, per IP, during each 10-minute window. The counter is shared across all NodeBB workers. |
| Widget script URL | Optional override for the widget JavaScript URL. Leave empty to use the locally served widget when available. |

Login is used often by real visitors, so keep that form's difficulty modest.

### Secrets

No additional secrets need to be configured.

The plugin derives two HMAC secrets for each form from the `secret` value in NodeBB's `config.json`: one for the challenge signature and one for the key signature. The same inputs always produce the same secrets, so every NodeBB process can verify a challenge another process issued.

A challenge is valid only for the form that issued it. A login challenge cannot be redeemed on registration or password reset. That matters because each form can use a different difficulty.

Rotating NodeBB's `secret` invalidates challenges issued under the previous secret. Visitors may need to retry.

## How it works

### Challenge generation

The widget requests `GET /api/altcha/challenge/:form`, where `:form` is `register`, `login`, or `reset`.

An unknown form name, and a form that is turned off, both return `404`.

When the form is enabled, the plugin generates a PBKDF2/SHA-256 challenge using that form's cost and counter range, and signs it with that form's HMAC secrets. The signatures let the server check authenticity and the solution without another PBKDF2 derivation.

### Widget

The client script inserts `<altcha-widget>` on the registration, login, and password-reset pages, directly before the submit button. It does not edit `register.tpl` or the other form templates, so a theme that overrides those templates still gets the widget as long as the page keeps the `#register`, `#login`, or `#reset` button.

The widget is always created with `auto="off"`. Only a click on the checkbox starts verification.

### Rate limiting

Each challenge request increments a fixed-window counter for that form and IP. The window is 10 minutes. The counter lives in the NodeBB database and uses the same atomic `incrObjectField` operation as replay protection, so the limit holds across workers and survives a process restart.

The stored key contains a keyed hash of the IP, derived with HMAC from NodeBB's `secret`. The raw address is not written to the database.

If that database call fails, the check fails open and the challenge is still issued. A database hiccup does not lock people out of registering or logging in. A client that exceeds the limit receives `429` and a `Retry-After` header.

### Efficient verification

The plugin uses deterministic challenge generation with key signatures. On submit, the server validates the challenge and its solution with that form's HMAC secrets, without another PBKDF2 derivation.

This makes invalid attempts relatively inexpensive to reject.

### Single-use challenges

Successfully verified challenges are marked as used in the NodeBB database.

The plugin uses an atomic `incrObjectField` operation so a challenge cannot be accepted more than once, even when requests are handled by different NodeBB processes.

Replay identifiers are recorded **only after successful verification**, following the hardening introduced in `altcha-lib` v2.6.0:

[altcha-lib v2.6.0 release notes](https://github.com/altcha-org/altcha-lib/releases/tag/v2.6.0)

A challenge is consumed once verification succeeds. A later failure — for example, a username that is already taken — still burns the challenge.

The client script resets the widget after every `/register` or `/login` response, and after the password-reset socket call, so the visitor can retry with a fresh challenge.

### Submit handling

Submitting the form does not start verification. The visitor clicks the ALTCHA checkbox first. If they submit before that, the server rejects the request and asks them to complete that form's verification.

Registration and login include the widget's hidden field in the normal post. Password reset is sent over socket.io (`user.reset.send`). After the checkbox is complete, the client attaches the payload to that call as `{ email, altcha }`. An unchecked reset is sent unchanged, and the server rejects it.

## Difficulty tuning

The default difficulty settings apply to each form. They are starting points, not universal recommendations:

| Setting | Default |
|---|---:|
| PBKDF2 cost | `2000` |
| Counter min | `1000` |
| Counter max | `3000` |
| Challenge lifetime | `600` seconds |
| Abuse limits | `30` requests per IP per form per 10 minutes |

These values are intended as a starting guess for a few seconds of work on a typical machine, but actual performance varies considerably by device and browser.

**Test on mobile phones as well as desktop computers.** Adjust the cost and counter range based on measured performance and the level of protection you need. Login in particular should stay modest, because legitimate users hit it often.

Higher difficulty increases the computational work required from clients. Excessive settings can make a form frustrating or impractical on slower devices.

## Limitations

- **Standard forms only.** SSO signups and accounts created by administrators are not gated. Login and password reset are gated only when those forms are enabled.
- **Password reset socket.** Reset protection wraps NodeBB's `user.reset.send` socket method. If that method is missing on a given NodeBB version, the ACP shows a warning and reset protection stays inactive.
- **Challenge consumption.** Once a challenge has been successfully verified, it cannot be reused. A later form failure requires a fresh challenge.
- **Rate-limit fail-open.** If the database call that updates the counter fails, the request is allowed through.
- **Device performance.** Proof-of-work duration varies by hardware and browser, so difficulty settings should be tested on representative devices.

## Dependencies

- [ALTCHA](https://github.com/altcha-org/altcha) — browser widget.
- [altcha-lib](https://github.com/altcha-org/altcha-lib) — challenge generation and verification.

## License

MIT
