# TroysSafes 2.0

Staff scheduling, clock in/out, team messages, and Admin-only account management, adapted from the TroysSafes Figma design.

## Cloudflare hosting

Run `npm ci`, then `npm run deploy`, or connect this repository to Cloudflare Workers Builds with deploy command `npx wrangler deploy`. Use Worker name `troyssafes-2-0`. The checked-in configuration deploys the website, API, and a SQLite-backed Durable Object for persistent staff data.

A new deployment has no demo users or shared passwords. In Worker Settings, add a secret named `SETUP_TOKEN` with a long random value. Open the website's `#setup` page, enter that token, and choose the first Admin's ID and password. Setup is disabled after the first Admin is created. The secret can then be removed.

Admins create staff IDs in Accounts and privately give each new user their invitation code. Signup requires both the ID and invitation code, then the user chooses their own password. Admins can edit roles and deactivate accounts. Staff data and passwords are never stored in this repository.

## Access

- Employee: own clock dashboard, published schedules, messages.
- Manager: scheduling and messages.
- Admin: clock oversight, schedules, messages, and account management.

## Local development

`npm run dev` runs the Cloudflare application locally. Put a local `SETUP_TOKEN` in an ignored `.dev.vars` file to test first-admin setup. Local Durable Object data stays under ignored `.wrangler/`.

`npm start` runs the original Node.js preview at `http://127.0.0.1:4173` with a separate local JSON database. Optional local sample passwords can be supplied with `TROYS_DEMO_PASSWORD` when initializing a fresh database. This local server is not the Cloudflare production backend.

Runtime data, credentials, and local test records are excluded from Git.
