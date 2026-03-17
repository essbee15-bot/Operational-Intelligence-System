# One-Page Project Blueprint

PROJECT NAME: SaaS Performance & Leadership System
PROJECT OWNER: User
VERSION: 1.0
DATE: 2026-03-16

## 1. PRODUCT PURPOSE
A leadership, performance, and operating system platform focused on tracking 1:1 meetings, projects, and KPIs. It is designed to track not just the "whats" (KPIs) but also the "hows" and "behaviors" through meeting outcomes, project progress, and experimentation tracking. Over time, it should also predict future results (e.g., project outcomes, identifying patterns of success/failure) and identify who is most likely to accomplish goals based on their past behavior and management ratings, allowing companies to promote based on data rather than personal PR.

## 2. TARGET USERS
Multi-tiered users within an organization (e.g., executives, managers, and individual contributors), requiring distinct roles and visibility permissions.

## 3. CORE PROBLEM
Lack of structured visibility into how teams are performing, what projects they are running, what's working vs. what isn't, and the outcomes of 1:1 meetings and experiments. Additionally, it aims to solve the problem of measuring projects' effect on capacity—how much time is consumed, allowing for better planning and resource allocation.

## 4. MVP GOAL
Deliver a standalone, multi-tiered platform that allows a pilot company to track users, org structure, 1:1 meetings, projects, tests/experiments, and core KPIs without relying on external integrations.

## 5. CORE MODULES
- Auth & Users (Multi-tier roles)
- Org Structure & Reporting Lines
- Billing & Subscriptions (Stripe Integration)
- 1:1 Meetings (Auto-prepopulated with previous meeting contexts and actions)
- Projects & Experiments (Tracking successes, failures, and challenges)
- KPI Tracking (Customizable / tailored to specific departments and orgs)
- Basic Dashboards & Reporting

## 6. TECH STACK
- **Frontend:** Next.js
- **Backend:** Next.js API Routes
- **Database:** Supabase (Postgres)
- **Auth:** Supabase Auth
- **Payments:** Stripe
- **Hosting:** Vercel
- **Monitoring:** Sentry

## 7. DATA FOUNDATION
- Organizations/Tenants
- Users & Roles
- Org Units / Teams
- Meetings & Meeting Templates
- Projects & Experiments
- Action Items
- KPIs & KPI Records

## 8. PERMISSIONS FOUNDATION
- Multi-tier Role-Based Access Control (Admin, Manager, Contributor)
- Hierarchy-based visibility (Managers see team data, individuals see own data)
- Strict tenant isolation (for future SaaS scale)

## 9. ENTERPRISE FOUNDATIONS
- Multi-tenant data structure
- Audit logs for critical actions
- Scalable database schema ready for pgvector

## 10. AI PLAN (Phase 2)
- Readies the platform for future AI insights by focusing strictly on collecting structured operational data (meeting notes, action outcomes, project results) first.
- Future AI layer will summarize 1:1s, generate project insights, and support vector-based knowledge retrieval.

## 11. NON-NEGOTIABLE RULES
- MVP must support multi-tier roles from Day 1.
- No external integrations needed for MVP; system must work standalone.
- Implement strict tenant isolation.
- Focus on capturing structured data before introducing AI features.
- **SECURITY:** No API keys, passwords, or sensitive account information may ever be hardcoded or exposed in the codebase. If required, they must use secure environment variables, and the developer must explicitly inform the user why and where they will be used.

## 12. CURRENT PHASE
Phase 1: Planning and MVP Blueprinting

## 13. NEXT 3 PRIORITIES
1. Finalize the Data Model & Schema definitions.
2. Define the Permissions Model map.
3. Establish the Agent prompt definitions for the builder AI.
