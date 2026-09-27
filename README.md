# TroysSafes 2.0

Staff scheduling, clock in/out, team messages, and Admin-only account management, adapted from the TroysSafes Figma design.

## Current local preview

Requires Node.js. Run `npm start`, then open `http://127.0.0.1:4173`.

This version uses a local JSON database and is not ready for public hosting. Runtime data, passwords, sessions, and local test records are excluded from this repository. Optional sample login passwords can be set through the `TROYS_DEMO_PASSWORD` environment variable when initializing a fresh local database; no password is included in source.

## Access

- Employee: own clock dashboard, published schedules, messages.
- Manager: scheduling and messages.
- Admin: clock oversight, schedules, messages, and account management.

New users activate an assigned ID and choose their own password. Production activation requires an additional verification mechanism before public deployment.

## Cloudflare

Cloudflare hosting preparation is in progress. The current Node.js server and filesystem database must be adapted to a Worker and durable cloud storage before deployment. Do not deploy the static frontend alone; login and data actions require the API.
