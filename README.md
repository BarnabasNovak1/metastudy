# MetaStudy

**Live:** https://metastudy-e1ba2.web.app

MetaStudy is an AI-powered study platform built with **Meta's Llama models** through the Llama API. Drop in notes, slides, PDFs, or photos of handwritten pages — get back flashcards, quizzes, summaries, lesson plans, and a study chat that knows your material.

## Problem statement — Build for Your World

Students juggle five or more tools to study one subject: a notes app, a flashcard app, a quiz generator, a summarizer, a chatbot, and a resume builder — none of which talk to each other. MetaStudy brings Meta's models into the study domain and collapses that stack into one app, freeing up the time and mental space students lose to managing tools instead of learning.

## What it does

- **Study Chat** — an AI tutor grounded in your own materials, with multiple personality modes
- **Summarizer** — condense long notes, PDFs, and documents into the points that matter
- **Flashcards & Quizzes** — generate decks and quizzes from your material, or build them by hand; short answers are graded by AI against the creator's sample answer
- **Lesson Generator** — turn raw material into structured lesson plans
- **Handwriting to text** — photograph a notebook or whiteboard and turn it into usable text
- **Study Feed** — share creations as community challenges, join others' challenges, leaderboards, private study groups with invite codes
- **Career Launchpad** — resume builder with AI grading, LinkedIn posts, mock interviews, career recommendations
- **Motivation** — streaks, XP, achievements

## Meta models

All AI features run on **Meta's Llama models** via the official Llama API (`api.llama.com`), called server-side from Cloud Functions — text generation, vision for handwriting/document OCR, and AI grading share one pipeline.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind + shadcn/ui · Capacitor-ready for Android/iOS
- **Backend**: Firebase — Auth, Firestore, Storage, Cloud Functions (`functions/`)
- **AI**: Meta Llama API (server-side only, keys never reach the client)
- **Payments**: Stripe · **Email**: Resend · **Monitoring**: Sentry

## Development

```bash
npm install
cd functions && npm install && cd ..
npm run dev          # Vite dev server on :8080
npm run dev:server   # local API server (server/server.js)
```

Requires Node 22+. Set `LLAMA_API_KEY` (or `META_API_KEY`) in `functions/.env`.

## Build & deploy

```bash
npm run build        # vite build → dist/
firebase deploy      # hosting + functions + firestore/storage rules
```

## Tests

```bash
npm test             # vitest (unit + Firestore rules tests)
npm run test:rules   # Firestore emulator tests
```

## Docs

- `docs/COMPLIANCE.md` — FERPA/COPPA/GDPR implementation map
- `docs/PAYMENTS_AND_REVIEW.md` — payment flow and review findings
- `firestore.rules` — owner-only access model, tested under `tests/rules/`
