# CrewChief

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

## Running locally

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase and Google API keys
3. `npm run dev`

Built with [Bolt.new](https://bolt.new).
