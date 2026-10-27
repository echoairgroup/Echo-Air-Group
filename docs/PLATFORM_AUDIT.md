# Echo Air Group — platform audit and expansion plan

**Audit date:** 27 October 2026  
**Scope:** GitHub repository, Render API service metadata, Neon project/branch metadata, and repository automation.  
**Production changes:** None made during the audit.

## Confirmed architecture

- Repository: `echoairgroup/Echo-Air-Group`, default branch `main`.
- Existing frontend: multiple static HTML pages (home, about, booking, contact, fleet, join, legal, manager, manual, pilot, privacy, ranking, routes, team, plus `Server.html`).
- Existing API: Express 5 / Node.js backend in a roughly 4,700-line `server.js`.
- Data integration: Neon PostgreSQL with `users` and `flights`; a read-only production count observed 4 users and 664 flights during this audit.
- External integrations: NewSky flight sync and optional Discord bot/OAuth functionality.
- Render production API service: `Echo-Air-Group-api`, connected to this repository's `main` branch, automatic deploys enabled, free plan, current configured service start command `node server.js`. No Render health-check path is configured.
- Neon project: `Echo Air Group`; production branch is `production`. Its automatic snapshot schedule returned an empty schedule during the audit.

## Issues confirmed from source/configuration

1. **Predictable JWT fallback:** the API used the public fallback string `CHANGE_THIS_SECRET` if `JWT_SECRET` was absent.
2. **Missing authorization boundary:** `/api/sync/all` and `/api/admin/database-stats` required only a valid account token, not an explicit administrator check. Database diagnostics returned per-user identifiers.
3. **No request-size cap or login/register throttling:** the API used unrestricted JSON parsing and had no rate limit on account creation/login.
4. **Unescaped dashboard output:** pilot and flight data was inserted into `Server.html` with `innerHTML` without escaping.
5. **Localhost fallback:** `Server.html` used `http://localhost:3000/api` in production and hard-coded the ranking endpoint to localhost.
6. **Inconsistent rank thresholds:** the standalone account dashboard used thresholds of 100/250/500/750/1000 stars while the API and other ranking pages use 1000/2500/5000/7500/10000.
7. **Form submissions were not managed in one place:** contact and manager forms used a third-party mail handler, while the website lacked an access-controlled review inbox and audit history.
8. **Self-mutating workflows:** `fleet-fix.yml` and `fleet-run.yml` modify website files and push changes back to the default branch; `fix-server-routes.yml` also rewrites and pushes backend source. The latest observed fleet workflow runs failed.
9. **No small, read-only quality gate:** the repository did not have a pull-request validation workflow.
10. **Backup readiness:** Neon returned no configured snapshot schedule for production. A backup/restore policy should be established before destructive schema or data work.

## Changes made on `codex/platform-expansion`

- Removed the predictable JWT signing fallback. Authentication now returns service unavailable if the secret is missing, and token creation fails closed.
- Added baseline HTTP security headers, a 256 KB JSON body limit, in-memory registration/login rate limits, configurable CORS origins, and an opt-in `ADMIN_USER_IDS` allow-list.
- Protected global flight synchronization and database diagnostics with administrator authorization. If no admin list is configured, the routes remain disabled rather than granting access to every registered pilot.
- Fixed the account dashboard's hosted API fallback and shared ranking endpoint; escaped dynamic HTML values; aligned displayed rank thresholds with the backend.
- Replaced the pilot application form's third-party mail submission with a first-party API, a privacy acknowledgement and transactional Neon persistence.
- Added first-party APIs and Neon persistence for pilot applications, contact messages and management applications; public submissions are rate-limited and validated. Optional Discord alerts can notify a configured channel using reference numbers only.
- Added separate pilot recruitment and combined contact/management inbox screens with admin-only access, search/filter, pagination, status updates, private review notes and transactional event history.
- Added explicit privacy acknowledgements to the forms and updated the privacy policy. A fixed retention schedule, a real `ADMIN_USER_IDS` list, exact CORS origins and optional `DISCORD_APPLICATIONS_CHANNEL_ID` still need to be configured before production.
- Added accessible focus states, reduced-motion support, tests, project validation, environment examples, documentation, and a read-only CI workflow.
- Planned removal of workflows that push generated changes directly back to the repository on this feature branch.

## Release steps that still need environment-specific verification

- Before a production rollout, verify that Render has a strong `JWT_SECRET` configured. If the old public fallback was in use, sessions signed with it will not remain valid after release and affected pilots will need to sign in again.
- Configure `ADMIN_USER_IDS` with actual trusted administrator IDs from `public.users`; do not guess. Until configured, admin-only sync/statistics routes intentionally return 503.
- Verify the canonical frontend hostname and set `CORS_ORIGINS` to the exact required origins. Until confirmed, legacy permissive CORS remains enabled for compatibility.
- Set Render's health-check path to `/api/health` after verifying the staging deployment.
- If recruitment wants notifications, set `DISCORD_APPLICATIONS_CHANNEL_ID` in Render to a channel the bot can send messages to. Notifications intentionally contain submission type and reference number only.
- Configure Neon snapshots/backup retention and test restore to a separate branch.
- Establish a concrete retention schedule for stored contact and recruitment submissions, then configure and test deletion/anonymization procedures. The current policy deliberately discloses that a fixed period is not yet published.
- The booking page references a future `/api/google-wallet` endpoint in a code comment; no corresponding backend route was found in the API route inventory. Google Wallet passes need credentials and a real implementation.
- Continue splitting the large API module into route/service modules once regression coverage is stronger.

## Next implementation phases

1. Establish a tested staging deployment using only the isolated Neon development database.
2. Standardize authentication, explicit pilot/admin roles, and dashboard behavior.
3. Establish notification routing and a documented retention/deletion process for the first-party submissions inbox.
4. Centralize frontend API configuration and shared page components without changing the Echo green/charcoal brand.
5. Improve booking, route/flight data integration, responsive UX, accessibility, SEO, and performance.
6. Add database migration tooling, backup/restore drills, integration tests, health monitoring, and controlled releases.
