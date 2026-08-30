# Well Kept

An AI auto-ownership consultant. Track the vehicles in your garage, pull real
vehicle spec data, log maintenance and modifications, and ask an AI consultant
questions about owning and maintaining your cars.

**Live demo:** https://crewchief-demo.davidmasterson.co

## What it does

- **Garage** — add vehicles and track status, mileage, and health history over time
- **Maintenance & mods** — log service records, keep a parts wishlist, and store documents
- **Vehicle data** — pull real specifications from NHTSA
- **AI consultant** — ask ownership and maintenance questions, answered with Google Gemini
- **Demo mode** — preloaded sample vehicles so you can try it without signing up

## Stack

- Next.js (App Router) + TypeScript
- Supabase — Postgres, Auth, Row Level Security, and storage
- Google Gemini (`@google/genai`) for the AI consultant
- TanStack Query, React Hook Form + Zod, Tailwind CSS, Radix UI / shadcn, Framer Motion
- Jest for tests

## How the AI works

Gemini models are tiered by cost and capability rather than using one model
everywhere:

| Job | Model | Why |
|---|---|---|
| Vehicle dossier & structured JSON | Flash, low temperature | Cheap, schema-validated output (Zod) |
| Consultant conversation | Pro | Reasoning over the full vehicle record |
| Invoice OCR / vision | Flash vision | Line-item extraction from photos |

The consultant can also write back to the database mid-conversation via
structured command tags (add wishlist items, close issues, update mod status).
Tag parsing is isolated in `lib/consultant-commands.ts` with unit tests against
malformed model output; all Gemini-backed actions are rate limited
(`lib/rate-limit.ts`).

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Public anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Service-role operations |
| `GEMINI_API_KEY` | server only | Google Gemini |

## Running locally

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase and Google API keys
3. `npm run dev`

Built with [Bolt.new](https://bolt.new).
