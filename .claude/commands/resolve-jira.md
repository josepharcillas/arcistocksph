---
description: End-to-end resolve a Jira issue with the full compound-engineering pipeline — fetch (Jira), brainstorm, plan, work, test, review, compound, then push and close the ticket.
argument-hint: <Jira issue key (e.g. ARCI-123) | issue URL>
---

You are resolving Jira issue **$ARGUMENTS** end-to-end using the **compound-engineering pipeline**.

The spine is the six CE stages, run in order: **brainstorm → plan → work → test → review → compound**. Each is a real decision gate. Do **not** skip a gate silently, and do **not** invent scope beyond the ticket. If a stage is genuinely not needed, say so explicitly and move on. If anything is ambiguous, surface it — one question max per gate.

Track progress with TaskCreate so the user can see where you are in the pipeline (one task per stage below).

Read `CLAUDE.md` for project conventions before writing any code.

---

## Stage 0 — Fetch the ticket (Jira)

Jira access is the **Atlassian Rovo MCP** (`mcp__claude_ai_Atlassian_Rovo__*`).

1. If the Rovo tools aren't authenticated yet, call `mcp__claude_ai_Atlassian_Rovo__authenticate`, share the auth URL with the user, and finish with `mcp__claude_ai_Atlassian_Rovo__complete_authentication` once they return the callback URL. (First run only — the session stays authed afterward.)
2. Fetch the issue by key/URL via the Rovo Jira "get issue" tool. Extract: summary, description, issue type (Bug vs Story/Task), status, comments, acceptance criteria.
3. If the ticket is already Done/Closed, stop and tell the user.
4. Summarize the ticket in 2–3 sentences and confirm the classification (bug vs feature) — it decides whether replication (Stage 0b) runs.

## Stage 0b — Replicate (bugs only)

**Skip for stories/tasks/enhancements.**

1. Identify the affected page/component from the ticket.
2. `npm run dev`, reproduce the reported steps.
3. Capture actual vs expected behavior + console errors.
4. Post the reproduction as a comment back on the Jira ticket (Rovo comment tool).

If you cannot reproduce after one honest attempt, stop and ask.

## Stage 1 — Brainstorm

Invoke `/compound-engineering:ce-brainstorm` **only if the ticket has unresolved product/approach questions** (fuzzy scope, multiple plausible directions, undefined behavior). It produces a right-sized requirements doc in `docs/brainstorms/`.

If the ticket is already concrete (clear acceptance criteria, one obvious approach), say "scope is clear — skipping brainstorm" and go to Stage 2.

## Stage 2 — Plan

Invoke `/compound-engineering:ce-plan` on the ticket (or the brainstorm doc if Stage 1 ran). The plan must:
- List concrete files to touch.
- Restate the ticket's acceptance criteria as the definition of done.
- Note any Supabase schema (`docs/schema.sql`) or API changes.

Skip for trivial one-file changes (≤10 lines) — say so explicitly.

## Stage 3 — Work

Invoke `/compound-engineering:ce-work` to execute the plan. Stay in scope only — file a new Jira ticket for anything adjacent you discover.

## Stage 4 — Test

- `npm run build` (catches type + import errors) and `npm test` must be green.
- Invoke `/compound-engineering:ce-test-browser` to drive the affected pages at `http://localhost:4321`.
- Auth-related changes: verify with a real Supabase session.

Do not proceed with a red build or failing tests.

## Stage 5 — Review

Invoke `/compound-engineering:ce-code-review` on the branch diff. Address findings inline; re-run until clean (or the remaining findings are explicitly accepted).

## Stage 6 — Compound

Invoke `/compound-engineering:ce-compound` to capture anything reusable (a new pattern, a gotcha, domain vocabulary). Skip only for purely mechanical changes — say so.

## Stage 7 — Push & close the ticket

1. Commit referencing the ticket key in the message (e.g. `feat(ARCI-123): <summary>`). Push per project convention (`[skip ci]` until prod infra is live — see `CLAUDE.md`).
2. Transition the Jira ticket to Done and add a closing comment via the Rovo tools: `Resolved in <commit-sha>. <one-line summary>.`

Confirm before the two irreversible actions: pushing, and transitioning the ticket.

---

## Guardrails

- **Stay in scope.** The ticket's acceptance criteria define done. File new Jira tickets for related problems rather than expanding this one.
- **Don't skip bug reproduction.** Fixing an unreproduced bug causes regressions.
- **Don't skip checks.** Green `npm run build` + `npm test` is the minimum bar.
- **Confirm before irreversible actions** (push to main, transition/close the ticket).
- **Respect the experiment-purity rule** (`CLAUDE.md` / memory): behavior changes to the running paper bots ship as NEW bots, never as in-place mutations.
- **Check `CLAUDE.md`** for project conventions before coding.
