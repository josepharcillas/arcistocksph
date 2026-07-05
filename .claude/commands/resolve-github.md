---
description: End-to-end resolve a GitHub issue on josepharcillas/arcistocksph with the full compound-engineering pipeline — fetch, replicate (if bug), brainstorm, plan, work, test, review, compound, push, close.
argument-hint: <issue number | issue URL>
---

You are resolving GitHub issue **$ARGUMENTS** on `josepharcillas/arcistocksph` end-to-end using the **compound-engineering pipeline**.

The spine is the six CE stages, run in order: **brainstorm → plan → work → test → review → compound**. Each is a real decision gate. Do **not** skip a gate silently, and do **not** invent scope beyond the issue. If a stage is genuinely not needed, say so explicitly and move on. If anything is ambiguous, surface it — one question max per gate.

Track progress with TaskCreate so the user can see where you are in the pipeline (one task per stage below).

Read `CLAUDE.md` for project conventions before writing any code.

---

## Stage 0 — Fetch the issue

```bash
gh issue view <num> --repo josepharcillas/arcistocksph --json number,title,body,labels,state,comments,assignees,milestone
```

Extract: title, body, labels (bug vs enhancement), comments, state.
If already closed, stop and tell the user.
Summarize in 2–3 sentences. Confirm bug vs feature classification — it decides whether replication (Stage 0b) runs.

## Stage 0b — Replicate (bugs only)

**Skip for features/enhancements.**

1. Identify the affected page/component from the issue body.
2. Start the dev server: `npm run dev`
3. Reproduce the reported steps.
4. Capture: actual behavior, expected behavior, console errors.
5. Post a reproduction comment on the issue.

If you cannot reproduce after one honest attempt, stop and ask.

## Stage 1 — Brainstorm

Invoke `/compound-engineering:ce-brainstorm` **only if the issue has unresolved product/approach questions** (fuzzy scope, multiple plausible directions, undefined behavior). It produces a right-sized requirements doc in `docs/brainstorms/`.

If the issue is already concrete (clear acceptance criteria, one obvious approach), say "scope is clear — skipping brainstorm" and go to Stage 2.

## Stage 2 — Plan

Invoke `/compound-engineering:ce-plan` on the issue (or the brainstorm doc if Stage 1 ran). The plan must:
- List concrete files to touch.
- Restate the issue's acceptance criteria as the definition of done.
- Note any Supabase schema (`docs/schema.sql`) or API changes.

Skip for trivial one-file changes (≤10 lines) — say so explicitly.

## Stage 3 — Work

Invoke `/compound-engineering:ce-work` to execute the plan. Stay in scope only — file a new issue for anything adjacent you discover.

## Stage 4 — Test

- `npm run build` (catches type + import errors) and `npm test` must be green.
- Invoke `/compound-engineering:ce-test-browser` to drive the affected pages at `http://localhost:4321`.
- Auth-related changes: verify with a real Supabase session.

Do not proceed with a red build or failing tests.

## Stage 5 — Review

Invoke `/compound-engineering:ce-code-review` on the branch diff. Address findings inline; re-run until clean (or the remaining findings are explicitly accepted).

## Stage 6 — Compound

Invoke `/compound-engineering:ce-compound` to capture anything reusable (a new pattern, a gotcha, domain vocabulary). Skip only for purely mechanical changes — say so.

## Stage 7 — Push & close

1. Commit with `Closes #<num>` or `Fixes #<num>` in the message. Push per project convention (`[skip ci]` until prod infra is live — see `CLAUDE.md`).
2. Close the issue:

```bash
gh issue close <num> --repo josepharcillas/arcistocksph --comment "Resolved in <commit-sha>. <one-line summary>."
```

Confirm before the two irreversible actions: pushing, and closing the issue.

---

## Guardrails

- **Stay in scope.** Issue body defines done. File new issues for related problems.
- **Don't skip bug reproduction.** Fixing unreproduced bugs causes regressions.
- **Don't skip checks.** Green `npm run build` + `npm test` is the minimum bar.
- **Confirm before irreversible actions** (push to main, close issue).
- **Respect the experiment-purity rule** (`CLAUDE.md` / memory): behavior changes to the running paper bots ship as NEW bots, never as in-place mutations.
- **Check `CLAUDE.md`** for project conventions before coding.
