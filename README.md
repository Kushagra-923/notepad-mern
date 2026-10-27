# Notepad

A notes app with accounts. React + Vite frontend, Express backend, SQLite storage.

- Sign up / log in (bcrypt-hashed passwords, JWT sessions). Optional Google sign-in.
- Notes are private to each user.
- Autosave, search, version history with restore, dark mode.

## Run locally

Requires Node 22.5+ (uses the built-in `node:sqlite`).

```bash
cp .env.example .env      # then set JWT_SECRET to a long random string
npm install
npm --prefix client install
npm run dev               # http://localhost:5173
```

## Production

```bash
npm install && npm run build
npm start                 # Express serves the API and the built client
```

Environment variables: `JWT_SECRET` (required), `PORT`, `DB_FILE` (SQLite path),
`GOOGLE_CLIENT_ID` (optional). SQLite is a local file, so on hosts with an ephemeral
disk use a persistent volume for `DB_FILE`.

## Deploy free on Render

New > Blueprint > pick this repo. No database setup is needed; notes live in a SQLite file.
On Render's free plan the disk is ephemeral, so accounts and notes reset whenever the service
restarts or sleeps. For permanent data use a paid plan with a persistent disk
(set `DB_FILE` to a path on the disk).
