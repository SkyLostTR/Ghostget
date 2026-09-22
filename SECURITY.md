# Security policy

ghostget downloads and starts an executable, so security reports are taken seriously. The project is maintained by
[SkyLostTR](https://github.com/SkyLostTR) (`@Keeftraum`).

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include what you did, what you expected and what happened, and the
output of `ghostget --version`.

You can expect an acknowledgement within a few days. Fixes are released as patch versions and credited in the changelog unless you
prefer otherwise.

## Supported versions

Only the latest release receives fixes.

## What is in scope

- Anything that lets a downloaded file run **without** a valid Microsoft signature, or that weakens the signature rule.
- Path traversal or overwriting files through a server-supplied file name.
- Command injection into PowerShell through user input, search results or server responses.
- Anything that makes the elevated helper (`install`, when a Store deployment service is `Disabled`) do more than
  `Set-Service`/`Start-Service`/`Stop-Service` on exactly the services it names, or that stops it from restoring a
  service's original `StartType` afterward.
- Sending data anywhere other than the Microsoft hosts listed in the README.
- Leaking credentials. (ghostget is designed never to handle any; if it does, that is a bug.)

## What is out of scope

- Behaviour of Microsoft's services or of an app you chose to install.
- Apps that ask you to sign in or pay: that is Microsoft's or the publisher's flow.
- Running with `--no-verify`, which disables the signature check by design and warns about it.
- Endpoints you redirected on purpose with `GHOSTGET_*_URL`.

## Design notes

- Only `https` endpoints are accepted (plain `http` only for localhost).
- The installer must have an Authenticode status of `Valid` and a signer organisation of exactly `Microsoft Corporation`, or it is deleted and never started.
- PowerShell runs from its absolute path with fixed scripts; data reaches it through environment variables, except
  for the elevated helper below, which embeds its (fixed-name, never user-supplied) service names and (network-
  sourced, so treated as untrusted) package family names as escaped single-quoted PowerShell literals instead,
  because environment variables are not guaranteed to cross the elevation boundary. Both are covered by an
  automated test that round-trips adversarial strings through the real PowerShell parser.
- ghostget elevates for exactly one narrow, disclosed reason: a Store deployment service that is `Disabled` needs
  admin rights to re-enable, full stop, for anyone. `install` asks once (the standard Windows UAC prompt — never
  silent, never skippable by ghostget itself), fixes only the specific service(s) that install needs, and restores
  each one to exactly the `StartType` it found it in once the install finishes or times out. `--no-elevate` disables
  asking entirely. No other elevation happens, and no setting outside a service's own temporary running state and
  `StartType` is ever changed — `wuauserv` in particular is never touched.
