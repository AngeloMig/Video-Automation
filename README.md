# Relay

An AI video production studio with two modes in one dashboard:

- **Faceless Creator** researches a topic, writes an original script, then adds narration, licensed
  B-roll and animated captions, and renders a 1080×1920 MP4.
- **AI Clipper** transcribes long videos you have the rights to, finds self-contained moments, and
  cuts them into captioned vertical clips.

This is Phase 1 of 4: create a project, discover content, generate, review, export. Publishing,
automation and paid billing have extension points but aren't built. See [HANDOFF.md](HANDOFF.md)
for current status and known gaps.

## Run it locally

You need Node 20+, pnpm and no Docker. This starts a real local Postgres, the web app and the worker:

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm dev:all
```

Open http://localhost:3000 and create an account. Accounts stay in your local database.

The first render downloads a headless browser of about 170 MB, unless you've already run
`npx remotion browser ensure`, and the Kokoro voice model of about 92 MB.

### What works with no API keys

| Feature | Without keys | Key that unlocks more |
| --- | --- | --- |
| Faceless video from your own script | Works, using Kokoro (a free local voice) and typographic backgrounds | `ELEVENLABS_API_KEY`, `PIXABAY_API_KEY` or `PEXELS_API_KEY` |
| Faceless video from a topic | Needs a key | `OPENAI_API_KEY` |
| Clip by timecode | Works, without captions | `OPENAI_API_KEY` |
| Transcription and AI highlights | Needs a key | `OPENAI_API_KEY` |
| YouTube discovery | Needs a key | `YOUTUBE_API_KEY` |
| Editor, preview, export, approvals, queue | Works | |

### Writing scripts

Paste a script into Faceless Creator's **My own script**. Each line can set its own footage and a big
on-screen stat. Start lines with two names to make a two-host podcast:

```text
Maya: Bees dry nectar until 18 percent water is left. [bees honeycomb | 18% | water left]
Theo: So germs can't grow? [microscope laboratory]
```

For a split-screen video, choose the **Split Runner** template on the project. Its game is original
animation drawn from code, so no third-party gameplay is involved.

Settings > Integrations shows what's connected. [.env.example](.env.example) documents every variable.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev:all` | Database, web app and worker together |
| `pnpm db:local` | Local Postgres only. Applies migrations on start |
| `pnpm worker` | Background worker. Run more of these to scale production |
| `pnpm test` | Unit, security and queue tests. Needs `pnpm db:local` running and no worker |
| `pnpm test:e2e` | Both modes through the real queue, Remotion and FFmpeg. Same requirements |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm db:generate` | New schema migration after you edit `src/db/schema.ts` |
| `pnpm db:migrate` | Applies migrations to `DATABASE_URL` |

## Deploying

1. **Supabase:** create a project and set `DATABASE_URL` (transaction pooler) and the two
   `NEXT_PUBLIC_SUPABASE_*` values. Run `pnpm db:migrate`, without `--local`.
2. **Storage:** create an R2 or S3 bucket, set the `S3_*` values, and allow browser `PUT` from your
   domain in the bucket's CORS rules.
3. **Web app:** any Next.js host works.
4. **Worker:** run `pnpm worker` on a long-running machine with Chrome's system libraries and enough
   CPU to render. It doesn't fit serverless functions. Add workers to raise production capacity.

Production refuses development sign-in, local storage and macOS voices unless you configure real
providers, so a missing setting fails visibly.

## Licensing to check before launch

- **Remotion** is free for individuals and small companies, but larger companies need a paid
  license. Check [its current terms](https://www.remotion.dev/license) for your situation.
- **macOS voices:** Apple's license text limits system voices to personal, non-commercial use and
  excludes public or commercial publishing. Use them for testing, and a licensed voice for anything
  you post. Check the license for your macOS version.
- **Footage and music:** the app requires a rights confirmation and stores license records, but
  that doesn't replace your own legal review.
- **Platform APIs:** Meta and YouTube publishing need app review, which can take weeks.
