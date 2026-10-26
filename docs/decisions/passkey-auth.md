# Passkey authentication and owner setup

Implemented on 26 October 2026 with `@simplewebauthn/server` 14.0.3, Worker `nodejs_compat`, Hono, Web Crypto, and D1. Password hashing and email delivery are not required by this implementation. This selects the passkey branch of the Phase 0 plan. It does not prove operation inside the remote Free CPU limit.

## Trust and storage

Registration and authentication require authenticator user verification. Discoverable credentials use the application origin's hostname as the relying-party ID. Registration offers ES256 and RS256 and requests no attestation. The verifier checks the stored challenge, exact origin, relying-party ID, user-verification flag, signature and credential counter. Public keys and counters persist in D1; private keys remain with the authenticator.

`APP_ORIGIN` sets the single accepted origin. When absent, the request URL supplies it. Production requires HTTPS; HTTP is allowed only on localhost, loopback IPv4, or loopback IPv6. Every authentication mutation requires an exact matching `Origin` header. In local Vite development set `APP_ORIGIN=http://localhost:5173` and open that origin, even when its proxy forwards to a Worker on port 8787. Origin values include the port; relying-party IDs do not.

A custom-domain change is an authentication migration. Existing passkeys registered for a `workers.dev` hostname will not authenticate for an unrelated custom hostname. Before switching, retain recovery codes and a tested recovery path at the new origin, or configure the intended stable domain before first owner registration. Do not silently change the relying-party ID and assume existing credentials will follow it.

Sessions contain a random 256-bit opaque cookie. D1 stores its HMAC-SHA256 hash under `APP_SECRET`, user ID, issue time and seven-day expiry. Cookies are HttpOnly and SameSite Strict, with Secure enabled for HTTPS. Logout deletes the server record; all-session revocation deletes every session belonging to the user. Every protected request reads the session and active user from D1. Workspace middleware reads current membership and role rather than trusting a client workspace ID. Security-management actions require a login no more than five minutes old.

## Bootstrap and atomic proof consumption

Both installation secrets must be different, 32-256 characters, and not recognized placeholders. Setup proof is submitted in the POST body, never a URL. Valid proof grants a five-minute WebAuthn registration challenge bound to the current setup-secret digest, origin, generated user/workspace IDs and names.

After cryptographic verification, a transactional D1 batch claims the unconsumed challenge with a random marker. Every derived write is gated on that marker. It creates the owner, workspace, membership, setup-state receipt, credential, recovery hashes and session together. The installation-wide singleton `setup_state` prevents two different owner challenges from both creating owners. A failing credential write rolls back the entire batch, including challenge consumption. Replaying a consumed challenge cannot create more records. There is no alternate public signup endpoint.

Login likewise claims the challenge only if the current credential counter and active user still match, updates its counter, and issues a gated session in the same batch. This avoids accepting a stale counter after concurrent verification. Synced authenticators with a zero counter remain supported by SimpleWebAuthn's verification rules. A previously consumed challenge is still rejected.

## Recovery, additional credentials and invitations

Setup, invite acceptance and successful recovery return eight random 192-bit recovery codes once. Only HMAC hashes persist. Recovery exchanges an unused code for a new passkey challenge, then consumes that code and challenge atomically. Successful recovery deletes previous passkeys, revokes previous sessions, invalidates all old recovery codes and returns replacements. Concurrent recoveries using one code admit only one replacement. A disabled or deleted user cannot recover. Adding a passkey and regenerating codes require a recent authenticated session. There are at most 20 passkeys and 20 live session records per user.

Workspace owners can create one-day, single-use invitation tokens bound to workspace and admin/viewer role. Only the token hash is stored. Acceptance creates a new passkey user and membership; it does not link an existing logged-in identity. The owner copies the token themselves; this app sends no invitation email. Before consumption, the transaction checks that the issuer remains an active owner. Owners can list and remove non-owner memberships; owner/self removal is blocked. Any authenticated user can create an independent workspace, with a cap of five owned workspaces and 100 workspaces per installation.

`APP_SECRET` rotation invalidates existing session, recovery and invitation hashes. Passkey credentials remain valid, so users can log in again and regenerate recovery codes. Setup-secret rotation invalidates pending setup challenges. Plan any application-origin change and secret rotation as an operator action with a recovery rehearsal; neither change is automatic.

## Bounded state and abuse limits

Each authentication action has a per-IP minute counter and an installation-wide counter, with HMAC IP labels rather than raw-IP storage. Requests remove a bounded number of expired challenge and limit rows. Active challenge count is capped at 2,000. Invitations are capped at 100 per workspace and 1,000 per installation before additional creation fails. Scheduled cleanup removes expired challenges, sessions, limits and invitations in batches of 100 each.

These controls bound application-created proof state and reduce abuse. They still consume D1 requests and cannot make a public single-database endpoint immune to a distributed request flood. Edge rate limiting and a measured resource envelope remain necessary before customer intake. Do not advertise a capacity or Free-plan CPU guarantee from local tests.

## Endpoint contract

All paths below are under `/api/auth`. Option responses contain `{ challengeId, options }` for SimpleWebAuthn browser `startRegistration` or `startAuthentication`.

| Method and path | Input | Result |
| --- | --- | --- |
| `GET /status` | Session cookie if present | `AuthStatus`, including configured/authenticated/secretsReady and current user/workspaces |
| `POST /setup/options` | `{ token, name, workspaceName }` | Registration challenge |
| `POST /setup/verify` | `{ challengeId, response }` | Session cookie and `{ ok, recoveryCodes }` |
| `POST /login/options` | `{}` | Authentication challenge |
| `POST /login/verify` | `{ challengeId, response }` | Session cookie and `{ ok }` |
| `POST /logout` | `{}` | Deletes current session and cookie |
| `POST /sessions/revoke` | `{}`, authenticated | Revokes all user sessions |
| `POST /passkeys/options` | `{}`, recently authenticated | Registration challenge |
| `POST /passkeys/verify` | `{ challengeId, response }`, recently authenticated | Adds verified credential |
| `POST /recovery/options` | `{ code }` | Replacement registration challenge |
| `POST /recovery/verify` | `{ challengeId, response }` | Replacement credential/session and new recovery codes |
| `POST /recovery-codes/regenerate` | `{}`, recently authenticated | New recovery codes, old codes invalidated |
| `POST /workspaces` | `{ name }`, authenticated | New owner workspace |
| `POST /invites` | `{ workspaceId, role }`, owner | Copyable `{ token, expiresAt }` |
| `POST /invite/options` | `{ token, name }` | Invited registration challenge |
| `POST /invite/verify` | `{ challengeId, response }` | New user session and recovery codes |
| `GET /workspaces/:wid/members` | Owner session | Up to 100 active members |
| `DELETE /workspaces/:wid/members/:uid` | Owner session | Removes non-owner membership |

## Verification and remaining gates

Worker/D1 integration tests use a generated ES256 authenticator fixture with real CBOR attestation, authenticator data and ECDSA signatures. The cryptographic verifier is not mocked. Tests cover setup/login, incorrect origin, placeholder secrets, used/expired challenges, concurrent first owners, atomic failure rollback, membership access, revoked sessions, concurrent recovery, disabled-user recovery, invitations, workspace limits, member removal, recent-auth requirements and bounded challenge intake.

Before public release, run a real browser with a virtual authenticator and real hardware passkeys, exercise origin migration/recovery, and record deployed CPU/memory/error measurements. The current implementation establishes local functional behavior, not remote Cloudflare Free compliance or a complete security audit.

Primary references: [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server), [WebAuthn specification](https://www.w3.org/TR/webauthn-3/), [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), and [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Package types and implementation were also inspected directly at the pinned installed version.
