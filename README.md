# Notepad: notes for study groups

**Live app:** https://notepad-wf1v.onrender.com
(free hosting: the first request after a quiet period can take about 30 seconds while it wakes up)

A notes app where a group can write together: private notes, notes shared with specific people, and team workspaces, with highlighting, version history and safe handling of simultaneous edits.

Author: Kushagra Shukla

## Problem statement

Students working in a group keep their lecture notes in chat messages, personal documents and screenshots. Nobody knows which version is current, one person's edit overwrites another's, and there is no record of who changed what. Generic note apps are single-user, and shared documents tools are heavy for what is really "our notes for this course".

## Target users

Small groups of students (study groups, project teams, lab partners) who want one shared place for course notes that stays organised and never silently loses anyone's work.

## Solution

Every note has an owner and a clear permission model. Notes can be private, shared with individual people as viewer or editor, or placed in a team where all members can edit. Saves are checked against a version number, so two people editing at once get a conflict choice instead of a silent overwrite. Every edit is archived with the author's name and can be restored. Key passages can be highlighted in four colours.

## Key features

The five workflows below are the core of the product:

1. **Accounts and private notes.** Sign up or log in with a username or email (optional Google sign-in), with passwords hashed. Notes autosave, are searchable, and are private to their owner.
2. **Rich text with highlighting.** Bold, italic, underline, strikethrough, headings, lists, quotes, and four highlight colours from a toolbar or a menu that appears when text is selected.
3. **Sharing with roles.** Owners share a note with another user as *viewer* (read only) or *editor*. Collaborators see it under "shared with me"; roles can be changed or revoked at any time, and a collaborator can leave.
4. **Teams.** Create a team, add members by username, and create notes inside it. Every member can read and edit team notes; the team owner can also delete and manage them. Notes can be moved into or out of a team.
5. **Safe co-editing and history.** The open note updates live as collaborators save. If two people edit from the same version, the second gets a banner (*keep mine* or *use theirs*). Each version records who wrote it; any version can be previewed and restored.

Also: dark mode that follows the system setting, show/hide password, responsive layout, loading/empty/error states, automatic retry when the connection drops.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TipTap (ProseMirror) rich-text editor, plain CSS |
| Backend | Node.js, Express |
| Database | PostgreSQL (Neon in production; PGlite, an embedded Postgres, locally and in tests) |
| Auth | JWT, bcrypt, optional Google sign-in (google-auth-library) |
| Security | express-rate-limit, sanitize-html |
| Testing | node:test (API), Playwright (real-browser end-to-end) |
| Hosting | Render (web service) + Neon (database) |

## Architecture

```
Browser (React + TipTap)  --REST/JSON, Bearer token-->  Express  -->  Postgres
        ^                                                  |
        +---- polls the open note every 4 s ---------------+
```

- `server/access.js` is the single place that decides what a user may do with a note (owner > editor > viewer, from ownership, team membership and shares).
- Saves use optimistic concurrency (a `version` column and a conditional `UPDATE`), returning 409 on conflict.
- The server sanitizes note HTML before storing it, because other users render it.
- Express serves the built client, so production is one service plus the database.

Diagrams, the data model, the permission table and the reasoning behind each decision are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

```
client/src/    React app: App.jsx (state), Editor, Sidebar, ShareDialog, TeamsDialog, HistoryPanel, Auth
server/        app.js, access.js, sanitize.js, schema.js, db.js, routes/{auth,notes,teams}.js
tests/         API tests (node:test)
e2e/           browser tests (Playwright)
docs/          architecture notes
```

## Local setup

Requires Node 20+. No database needs to be installed: without `DATABASE_URL` the app uses an embedded Postgres stored in `./data`.

```bash
git clone https://github.com/Kushagra-923/notepad-mern.git
cd notepad-mern
cp .env.example .env          # then set JWT_SECRET to a long random string
npm install
npm --prefix client install
npm run dev                   # http://localhost:5173 (API on :5000)
```

To generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | yes | Secret for signing login tokens (16+ characters). Never commit it. |
| `DATABASE_URL` | production | Postgres connection string (for example from Neon). If empty, an embedded database in `./data` is used. |
| `PORT` | no | Server port (default 5000; hosts set this automatically). |
| `GOOGLE_CLIENT_ID` | no | Enables "Sign in with Google" when set. |
| `AUTH_RATE_LIMIT` | no | Login/register attempts per 15 minutes per IP (default 20). |

## Testing

```bash
npm test                      # 44 API tests: auth, ownership, sharing roles, teams, conflicts, sanitizing
npm run build && npm run e2e  # browser tests in real Chrome with 2-3 users (set CHROME_PATH if needed)
```

The API tests run against a throwaway in-memory Postgres. The browser tests start the server, open several logged-in browsers, and check live collaboration, conflicts, roles, teams, formatting, offline recovery and that an injected `<script>` never runs in another user's browser.

## Deployment

The app is deployed on Render from this repository using `render.yaml` (a Blueprint): New > Blueprint > select the repo, then set `DATABASE_URL` to a free Neon Postgres connection string. Pushing to `main` redeploys automatically.

## Credits and AI use

The code was written with the help of an AI coding assistant (Claude), which was used for implementation, tests and documentation; the product design decisions, review and testing were done by the author. Libraries: React, Vite, TipTap, Express, node-postgres, PGlite, bcryptjs, jsonwebtoken, sanitize-html, express-rate-limit, Playwright. The project is original work and is not a fork of an existing application.
