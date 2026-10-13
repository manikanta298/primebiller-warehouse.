# Password reset OTP on Render

The login page's Forgot password flow uses a six-digit, cryptographically random OTP. Existing reset-link URLs and SMTP recovery endpoints remain supported. The new OTP endpoints use the existing mail delivery configuration.

## Deployment

1. Merge the feature PR and deploy the backend and frontend.
2. Set the backend Render environment variable `MAIL_DELIVERY_MODE=console`. Existing SMTP variables can stay configured; console mode opens no SMTP connection. Never put this setting or JWT_SECRET into frontend VITE variables.
3. The existing backend `npm run db:migrate` startup step creates `password_reset_otp_challenges`. Its user ID column inherits the actual users.id definition, including character set/collation. For manual phpMyAdmin setup, select the application database and import the whole file `backend/db/migrations/20261012-password-otp.sql` in one session. Existing users/passwords are not modified by the migration.
4. Use a test account to request an OTP, reset its password, and confirm that its old password/session no longer works.

## Using console recovery

Open Login → Forgot password → enter the account email → Request OTP. The server returns an opaque request reference, not the OTP. The screen shows its last eight characters.

In the backend Render Logs, search for `[PASSWORD RESET OTP]`. Match the email and request reference. The JSON log contains `otp`, `requestId` and `expiresInMinutes: 10`. Enter that six-digit code with a new password of 10–128 characters, confirm it and select Update password. Leading zeroes in an OTP are significant.

Only service administrators/log viewers can retrieve the console code. Users without Render access must obtain it from an authorised administrator. Console mode is for the current testing setup; switch to `MAIL_DELIVERY_MODE=smtp` with working SMTP settings for email delivery. The screen automatically describes the configured delivery mode.

The OTP is a password-reset credential. Limit access to Render logs. Treat it as a secret until it expires or is consumed.

## API and limits

`POST /api/v1/auth/forgot-password-otp` accepts `{ "email": "account@example.com" }`. It returns a generic notice, random `requestId`, `expiresInSeconds: 600` and the global delivery mode. Unknown, inactive and rate-limited accounts receive the same response shape. No OTP is returned in JSON.

`POST /api/v1/auth/reset-password-otp` accepts `{ "requestId": "64-character-reference", "otp": "six-digit-code", "password": "new-password" }`. Request references are tied to a particular OTP and account; an OTP alone is insufficient.

- OTP expires after 10 minutes.
- Five incorrect six-digit attempts exhaust that challenge. Failed attempts are committed to MySQL.
- At most three OTPs per account are issued in 15 minutes, including used/failed-delivery requests. A throttled request emits no code; wait for the window to pass before requesting again.
- A newly issued OTP invalidates older challenges for the same account.
- Request and verification endpoints also have process-local IP rate limits. Persistent per-account/challenge limits survive restarts and apply across workers.
- Database stores an HMAC digest, not the OTP. The digest includes the request/account identity and is keyed with the backend JWT secret.
- Successful reset is transactional, consumes all outstanding OTPs/reset links, hashes the new password and increments token_version to revoke earlier sessions.
- A password change through the existing reset-link flow also invalidates outstanding OTPs through the token-version check.

The OTP table is a request-history table, not a new account table. Routine retention/cleanup can remove old expired records after the request-limit window; that scheduled cleanup is not introduced in this feature.
