# Two-factor authentication and passkeys

Both live under **Profile → Security**.

- **Two-factor authentication** asks for a code from an authenticator app after
  your password. Turning it on (confirm your password first, if you have one)
  shows a QR code to scan and a set of **backup codes**; save those, each one
  signs you in once when the app isn't to hand. The sign-in page's code step
  accepts either. You can generate new backup codes or turn it off from the same
  panel.
- **Passkeys** sign you in with Touch ID, Windows Hello, a security key or your
  password manager instead of a password. Register as many as you like, name
  them, and remove the ones you no longer use. The sign-in page offers a passkey
  button and your browser's passkey autofill.

A passkey is bound to the **Dashboard URL**'s hostname (Settings → General), so
it only works when you open Homerun on that host or a subdomain of it; on any
other address the passkey option isn't offered. Set the Dashboard URL before
anyone registers one, since changing its hostname later strands every passkey
already registered. Settings → General warns before saving a Base domain or
Dashboard URL change that moves the hostname, with how many passkeys it would
strand, and asks you to confirm.
