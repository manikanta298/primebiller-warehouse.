# Stage 24 — Authentication Proxy Security and Release Acceptance

**Approval scope:** A reproducible deployment defect was fixed in the existing backend authentication rate limiter. This stage is *offline validated*, not evidence of successful deployment on a running Docker/MySQL instance. Stage 23 remains the accepted functional baseline.

## What was found

The backend was using `req.socket.remoteAddress` as the key for its per-worker authentication throttle. In the supplied Docker Compose architecture, the API only receives TCP connections from Nginx, so this address is **the same gateway-container IP for every remote user**. Once any user exhausted the 15-per-window login allowance, all users behind that gateway could be locked out of login for the remaining window (a denial of service even for other IPs). This was reproduced by a focused failing regression test before the change.

## Fix and changes

- `backend/src/app.ts`: Trust **exactly one** reverse-proxy hop, the private Compose Nginx gateway; do not trust an unlimited chain.
- `backend/src/rate-limit.ts`: Key the process-local limiter by `req.ip` (the resolved client IP under that one-hop trust model), falling back to `req.socket.remoteAddress` for direct local requests.
- `docker/nginx.conf`: Replace incoming forwarding-chain values on all proxied routes with the connection's `$remote_addr`; a user-supplied X-Forwarded-For can no longer influence the backend's resolved IP through the packaged gateway.
- `scripts/package-audit.mjs`: Fail the offline audit if the backend publishes a public port, the single trusted proxy hop is removed, or the gateway stops overwriting forwarded client IPs.
- New `tests/proxy-rate-limit.test.mjs` plus a new deployment-audit test assert different users sharing one Nginx socket receive independent backend limits, unchanged direct-IP behavior, and fail-closed configuration checks.

## Deployment topology and limitations

The supplied Compose file exposes **only Nginx**, with the backend and frontend on the Docker private network. Keep the backend port private. The trusted-one-hop choice is safe **only while the sole public HTTP ingress is the gateway, which overwrites forwarded addresses**. If another ingress (cloud load balancer/CDN/TLS proxy) sits in front of Nginx, `$remote_addr` may be that proxy's address and users may still share limits. In that topology, configure Nginx real-IP handling for **explicitly trusted upstream CIDRs** and keep its rewrite of `X-Forwarded-For` to the verified client address. Never trust arbitrary public forwarding headers. Review the edge configuration before production acceptance.

The gateway additionally uses per-IP `limit_req`, independent of the backend fixed-window limiter. As with other IP-based controls, unrelated users who share a public NAT address may intentionally share a quota. Per-IP throttling is a mitigation, not comprehensive credential-stuffing protection.

## Checks executed in this environment

| Check | Result |
|---|---|
| Baseline Stage 23 rule/regression suite | 247/247 passed before changes |
| Reproduction test on old limiter | **FAILED as intended**: second client behind the same Nginx socket was blocked |
| Focused Stage 24 fix and audit tests | 10/10 passed (all tests in the focused run) |
| Full rule/deployment regression suite | **251/251 passed** (four new tests) |
| TypeScript source parsing | Passed for modified `backend/src/app.ts` and `backend/src/rate-limit.ts` |
| Package audit | Passed |
| Live Docker/Nginx/MySQL startup, actual two-source-IP test | **NOT RUN**: services/test server unavailable |
| Installed-dependency builds, browser parity, external SMTP, transaction acceptance | **NOT RUN / still outstanding** |

### Live acceptance actions (not run here)

1. Review the gateway's true ingress topology. Keep backend port private; confirm Nginx overwrites `X-Forwarded-For` and supplies the verified source IP.
2. On a disposable staging server: install dependencies, run the full frontend/backend build and dependency-aware typechecks; `docker compose config`, `docker compose up -d --build`, and verify `docker compose ps` and `/health`.
3. Use **two distinct public client IPs** with dedicated staging-only accounts, check that exhausting the login allowance for one does not lock out the other. Confirm protected routes still reject unauthenticated calls and check both Nginx and API rate-limit responses. Do not deliberately lock out real accounts.
4. Execute the Stage 22 tenant isolation probes and Stage 23 workflow/MySQL rollback probes with isolated populated test records. Verify SMTP reset links and compare all original/current application screens at equal viewport sizes.
5. Preserve live evidence (timestamped command output, screenshots, migration logs) separately, review the Stage 23 acceptance matrix, then decide whether production release gates pass. A passing offline test suite is insufficient.

## Approval checkpoint

Stop here and request approval before any further release work. **Production status: BLOCKED pending live acceptance.**
