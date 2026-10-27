# Echo Air Group staging setup

This guide creates a separate staging API for the `codex/platform-expansion` branch. It must use the empty Neon development branch/database, never the production branch.

## 1. Render web service

In Render's **My Workspace**, choose **New → Web Service** and connect this repository.

Use these settings:

- **Name:** `echo-air-group-staging-api`
- **Branch:** `codex/platform-expansion`
- **Runtime:** Node
- **Build command:** `npm install`
- **Start command:** `node server.js`
- **Region:** Ohio
- **Health-check path:** `/api/health`
- **Auto-deploy:** enabled for this feature branch, not `main`

Do not attach this service to the existing production service or modify its settings.

## 2. Environment variables

In the new staging service's **Environment** settings, add the following variables. Enter secret values directly in Render's dashboard. Do not commit them, paste them into a pull request, or share them in chat or build logs.

| Key | Value |
|---|---|
| `DATABASE_URL` | Copy the connection string from Neon for project **Echo Air Group** → branch **development-platform-expansion** → database **echoair_staging**. Do not use the `production` branch or the production database. |
| `JWT_SECRET` | Generate a new staging-only random secret. For example, run `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` on your own machine and paste the result directly into Render. Never reuse the production secret. |
| `CORS_ORIGINS` | `https://echoairgroup.github.io` |
| `ADMIN_USER_IDS` | Leave empty until a staging test account is registered and its numeric `public.users.id` is verified. Then set only the trusted staging admin ID(s), comma-separated. |
| `NODE_ENV` | `production` |
| `NEWSKY_API_KEY` | Leave unset until NewSky integration is intentionally tested against a staging-safe configuration. |
| `DISCORD_BOT_TOKEN` | Leave unset unless a dedicated test bot is available. |
| `DISCORD_APPLICATIONS_CHANNEL_ID` | Optional. Use only a private test channel the staging bot can access. Notifications contain reference numbers only. |

The database connection string is privileged. Confirm the service is pointed to the intended staging database before saving it.

## 3. First deploy checks

After the environment variables are saved, let Render deploy the feature branch. Confirm:

1. `/api/health` returns HTTP 200.
2. Startup logs identify a successful PostgreSQL/Neon connection and contain no missing `DATABASE_URL` or missing `JWT_SECRET` errors.
3. `echoair_staging` contains `users`, `flights`, `pilot_applications`, `pilot_application_events`, `external_submissions`, `external_submission_events`, `bookings`, `booking_seats`, and `booking_events`. The current staging database has been prepared with these tables; its application tables are empty.
4. Test registration with a staging-only account, then use that account's verified numeric user ID to configure `ADMIN_USER_IDS` if an admin dashboard needs to be tested.
5. Verify an invalid booking request is rejected and that a valid virtual booking writes to staging only. Do not enter card details: this demo booking flow neither accepts nor processes payments.
6. Verify all admin endpoints return 401/403/503 when no valid staging admin session/configuration is present.

## 4. Frontend staging

The static website's normal default API URL is the existing production API for backward compatibility. Do not direct production visitors to this staging service. For end-to-end staging, use a staging-only frontend or a local preview that sets `window.ECHO_API_URL` to the new Render staging API **before** loading `script.js`, `booking.html`'s inline application code, and the three admin-page scripts. Do not commit a staging URL as the public production default.

## 5. Release boundary

- No production database, production environment variable, or `main` deployment is changed by this guide.
- Review and merge the feature pull request only after staging smoke tests pass.
- Establish a real submission-retention/deletion schedule and confirm the trusted administrator allow-list before production release.
