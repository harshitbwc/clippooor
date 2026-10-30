# Clippooor

**Turn one long video into a week of Shorts and Reels, on autopilot.**

Clippooor takes a long video and turns it into a steady stream of short-form content. Upload a file or paste a YouTube link, and it cuts the video into vertical clips, adds captions and a call-to-action, and posts them to YouTube Shorts and Instagram Reels at the times you choose.

Each brand gets its own channel with its own accounts and schedule. Set it up once and your pages stay active without manual editing or posting.

> **Status:** In development (working MVP)

## Features

- Upload a video or paste a YouTube link
- Auto-clipped into vertical, social-ready parts
- Captions burned in automatically
- Custom call-to-action on every clip
- Scheduled posting to YouTube Shorts and Instagram Reels
- Multiple brand channels, each with its own accounts and post times
- Dashboard to track every clip from draft to posted

## How it works

```
Ingest  →  Transcribe  →  Clip  →  Render  →  Schedule  →  Publish
```

1. **Ingest:** a video is uploaded to Cloudflare R2, or fetched from a YouTube URL.
2. **Transcribe:** Whisper generates word-level captions.
3. **Clip:** the video is split into numbered parts.
4. **Render:** FFmpeg produces vertical clips with captions and a call-to-action.
5. **Publish:** Inngest schedules and posts each clip to YouTube and Instagram.

## Tech stack

Next.js · React · TypeScript · Tailwind CSS · PostgreSQL (Neon) · Drizzle ORM · Inngest · Modal · FFmpeg · Whisper · Cloudflare R2 · YouTube API · Instagram API

## Project structure

```
app/        Next.js pages and API routes (dashboard, channels, settings, OAuth, ingest)
db/         Drizzle schema, migrations and queries
inngest/    Background jobs (render, schedule, publish)
lib/        Integrations (YouTube, Instagram, R2, Modal) and helpers
modal/      Serverless video worker (download, transcribe, render)
```

## Getting started

### Prerequisites

- Node.js 20+
- A Postgres database (e.g. [Neon](https://neon.tech))
- Accounts for [Inngest](https://www.inngest.com), [Modal](https://modal.com) and Cloudflare R2
- Google Cloud (YouTube Data API) and Meta (Instagram Graph API) OAuth apps

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# fill in every value in .env

# 3. Create database tables
npm run db:migrate

# 4. Deploy the video worker to Modal
#    (requires a Modal secret named "clippooor-secrets" with your R2 credentials)
modal deploy modal/app.py

# 5. Start the app
npm run dev
```

In a second terminal, run the Inngest dev server so background jobs execute locally:

```bash
npx inngest-cli@latest dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the `APP_PASSWORD` you set.

### Environment variables

See [`.env.example`](.env.example) for the full list. Never commit your real `.env`.

| Group | Purpose |
| --- | --- |
| App | Login password, session secret, token encryption key |
| Neon | Postgres connection string |
| Inngest | Event and signing keys |
| Modal | Worker credentials and endpoint |
| Cloudflare R2 | Video storage |
| Google / Meta | OAuth credentials for YouTube and Instagram |
| Alerts (optional) | Slack or Discord webhook URL, notified when a background job fails |

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint the code |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Open Drizzle Studio |

## Notes

- YouTube uploads stay private until the Data API project passes Google's compliance audit. Clippooor flags the affected channel when this happens.
- The raw source video is deleted from storage once all of its clips have been posted.
