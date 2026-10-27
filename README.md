# Echo Air Group

Echo Air Group is a virtual airline community website and pilot operations backend.

## Current architecture

- **Frontend:** multi-page HTML/CSS/JavaScript site. Shared brand styling lives in `style.css`.
- **API:** Node.js + Express in `server.js`, currently hosted as the `Echo-Air-Group-api` service on Render.
- **Data:** PostgreSQL on Neon. The backend initializes the `users` and `flights` tables and maintains them through idempotent migrations. Feature-branch work adds first-party pilot applications, contact messages, manager applications, virtual bookings and audit history.
- **Integrations:** NewSky flight synchronization, optional Discord bot/OAuth integration, first-party contact/recruitment intake and an admin-only review inbox, plus persistent simulator-only virtual bookings with automatic return-flight matching. The booking flow takes no payment and stores no card data.
- **Hosting:** the production API deploys from `main`. Website publishing is managed through GitHub Pages automation.

## Development setup

Requires Node.js 22 or newer.

1. Create/use a **development-only** Neon branch and database.
2. Copy `.env.example` to `.env` and populate development values. Do not use production database credentials in local development.
3. Install dependencies: `npm install` (the committed lockfile is being reconciled with the current backend dependencies).
4. Validate source: `npm run check`.
5. Run tests: `npm test`.
6. Start the API: `npm start`.

The API requires `DATABASE_URL`. Account registration and login also require a strong `JWT_SECRET`. Global synchronization and database diagnostics are disabled until `ADMIN_USER_IDS` contains the explicit comma-separated integer user IDs of trusted administrators.

## Safety and deployment

- Work on feature branches and open a pull request for review.
- Never commit `.env`, API keys, bot tokens, database URLs, or other credentials.
- Do not deploy a test branch against production Neon data.
- Database schema changes should be additive, reversible where possible, and verified on a Neon development branch before rollout.
- CI runs syntax checks and project validation without deployment credentials or write permissions.

See [docs/PLATFORM_AUDIT.md](docs/PLATFORM_AUDIT.md) for audit findings and the modernization plan.
