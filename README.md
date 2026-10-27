# Notepad

A notes app with accounts. React + Vite frontend, Express backend, Postgres storage.

- Sign up / log in (bcrypt-hashed passwords, JWT sessions). Optional Google sign-in.
- Notes are private to each user.
- Autosave, search, version history with restore, dark mode.

## Run locally

Requires Node 20+. Without `DATABASE_URL` it uses an embedded Postgres (PGlite) stored in `./data`, so no database install is needed.

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

Environment variables: `JWT_SECRET` (required), `DATABASE_URL` (Postgres connection string, required in production),
`PORT`, `GOOGLE_CLIENT_ID` (optional).

## Deploy free (Render + Neon)

1. Create a free Postgres database at neon.tech and copy its connection string.
2. On Render: New > Blueprint > pick this repo. Paste the connection string as `DATABASE_URL`.
3. Deploy. The free web service sleeps after 15 minutes idle and wakes on the next request.
