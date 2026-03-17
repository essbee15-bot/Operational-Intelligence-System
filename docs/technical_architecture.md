# Technical Architecture

This document defines the recommended architecture for the MVP and scaled phases.

## Core Stack
- **Frontend / Framework:** Next.js (App Router)
- **Backend:** Next.js API Routes / Server Actions
- **Database:** Supabase (Postgres)
- **Authentication:** Supabase Auth (Email/Password, with OAuth readiness)
- **Payments:** Stripe (Checkout and Webhooks for subscription state)
- **Hosting:** Vercel
- **Monitoring & Logging:** Sentry

## Architecture Principles
1. **Client/Server Separation:** Use React Server Components (RSC) where possible for data fetching to reduce client payload and secure database queries. Use Client Components only for interactive UI elements.
2. **Direct DB Access via RLS:** For simple reads/writes, the frontend can query Supabase directly using the Supabase client, relying entirely on Row Level Security (RLS) for authorization.
3. **Secure API Routes:** For complex operations involving secure external APIs (like Stripe webhook processing or future AI calls), use secure Next.js Server Actions or API Routes to hide logic from the client.

## Security & Pre-Requisites for Production
1. **Environment Variables:** All secrets (Supabase anon/service keys, Stripe secret keys) will be stored securely in Vercel. **Code must NEVER contain hardcoded API keys.** If a new API key is required, the developer must explicitly inform the project owner why it is needed.
2. **Database Migrations:** Schema changes must be handled via formal migration scripts to maintain data integrity across environments (e.g., Dev -> Staging -> Prod) in a multi-tenant environment.

## Phase 2 Architecture Readiness (AI Layer)
- **Vector Database:** Postgres with the `pgvector` extension enabled via Supabase.
- **AI Integration:** OpenAI API (or similar) accessed strictly via secure server-side routes.
- **Data Flow:** Operational data (meeting notes, behavior outcomes) will be securely embedded and stored in a specialized `knowledge_documents` table for retrieval-augmented generation (RAG) tasks, while preserving tenant isolation.
