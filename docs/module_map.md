# Module Map

This document breaks the platform into buildable modules to ensure a structured, phased construction by AI agents without scope creep.

## 1. Auth & Organizations (Foundation)
- **Purpose:** Secure login, multi-tier roles, and strict tenant isolation.
- **Key Inputs:** User email/password or OAuth.
- **Key Outputs:** Authenticated session, User Role, Organization Context.
- **Dependencies:** None
- **MVP Status:** Required Now

## 2. Billing & Subscriptions (Stripe)
- **Purpose:** Allow users to pay for the SaaS tool using Stripe checkout and manage subscriptions.
- **Key Inputs:** Stripe webhook events, checkout sessions.
- **Key Outputs:** Active/Inactive subscription statuses tied to Organizations.
- **Dependencies:** Module 1 (Auth & Orgs)
- **MVP Status:** Required Now

## 3. Org Structure & Users
- **Purpose:** Manage the people in the company, their reporting lines (who manages who), and their teams.
- **Key Inputs:** User profiles, Manager assignments, Team creation.
- **Key Outputs:** Org chart view, visibility rules (Managers see their direct reports).
- **Dependencies:** Module 1 (Auth & Orgs)
- **MVP Status:** Required Now

## 3. Template Management
- **Purpose:** Create and manage structured templates for 1:1s, team meetings, and projects. 
- **Key Inputs:** User-provided template structures (e.g., standard questions, expected formats).
- **Key Outputs:** Reusable template schemas applied during meeting or project creation.
- **Dependencies:** Module 2 (Org Structure)
- **MVP Status:** Required Now

## 5. 1:1 Meetings
- **Purpose:** Track 1:1s between managers and reports, including notes, behaviors, and agreed outcomes. This helps evidence reasons for promotion/rating, helps individuals know where they stand, and helps the employer promote the right behaviors.
- **Key Inputs:** Pre-defined templates. The system must automatically auto-populate the agenda with the topics and responsibilities discussed in the **previous month's meeting** to ensure nothing gets missed. Meeting details, behavioral observations, reasons for performance, success/failure/surprises, discussion about previous 1:1 actions, etc.
- **Key Outputs:** Historical log of interactions and performance context, with clear continuity from meeting to meeting.
- **Dependencies:** Module 3 (Org Structure), Module 4 (Templates)
- **MVP Status:** Required Now

## 6. Projects & Capacity
- **Purpose:** Track active projects, their outcomes (success/failure), and their drain on employee capacity/time.
- **Key Inputs:** Pre-defined project templates. Project goals, owner, capacity impact, start/end dates, post-mortem outcomes.
- **Key Outputs:** Project timeline, capacity crunch warnings, outcome history (for future AI prediction).
- **Dependencies:** Module 2 (Org Structure), Module 3 (Templates)
- **MVP Status:** Required Now

## 6. Action Items
- **Purpose:** Track tasks generated from Meetings and Projects.
- **Key Inputs:** Task details, assignee, due date.
- **Key Outputs:** Individual to-do lists, manager visibility into completion rates. This feeds into individual performance scores, ensuring people who execute well become visible even if they don't loudly voice their actions.
- **Dependencies:** Modules 4 & 5 (Meetings, Projects)
- **MVP Status:** Required Now

## 8. KPI Tracking
- **Purpose:** Track the "whats" (metrics) alongside the "hows" (meetings/projects). KPIs must be tailorable per department and organization, potentially using placeholders to adapt standardized KPI structures.
- **Key Inputs:** Target metrics, routine check-ins on current values, context notes, and department-specific placeholders.
- **Key Outputs:** KPI history.
- **Dependencies:** Module 3 (Org Structure)
- **MVP Status:** Required Now

## 9. Dashboards & Reporting
- **Purpose:** Provide a unified view of KPIs, Project Capacity, and Action Item completion for managers and executives. Also includes an **individual-level dashboard** so users can see their own outstanding actions, tests/experiments, and KPIs.
- **Key Outputs:** Visual dashboard combining data from Modules 5, 6, 7, and 8.
- **Dependencies:** Modules 5, 6, 7, 8
- **MVP Status:** Required Now

## 10. AI Prediction & Insights Layer (Phase 2)
- **Purpose:** Analyze historical data (projects, behaviors, KPIs) to predict future success, identify promotion candidates based on objective past execution, and summarize team health.
- **Dependencies:** Significant data accumulated in Modules 4, 5, 6, 7.
- **MVP Status:** Later (Do not build in Phase 1)
