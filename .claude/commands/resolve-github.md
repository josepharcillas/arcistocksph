---
description: End-to-end resolve a GitHub issue on josepharcillas/arcistocksph — fetch, replicate (if bug), brainstorm, plan, implement, review, capture learnings, push, close.
argument-hint: <issue number | issue URL>
---

You are resolving GitHub issue **$ARGUMENTS** on `josepharcillas/arcistocksph` end-to-end.

The flow has explicit decision gates. Do **not** skip a gate, and do **not** invent scope beyond the issue. If anything is ambiguous, surface it to the user — one question max per gate.

Track progress with TaskCreate so the user can see where you are in the pipeline.

---

## Stage 1 — Fetch the issue

```bash
gh issue view <num> --repo josepharcillas/arcistocksph --json number,title,body,labels,state,comments,assignees,milestone
```

Extract: title, body, labels (bug vs enhancement), comments, state.
If already closed, stop and tell the user.
Summarize in 2–3 sentences. Confirm bug vs feature classification.

## Stage 2 — Replicate (bugs only)

**Skip for features/enhancements.**

1. Identify the affected page/component from the issue body.
2. Start the dev server: `npm run dev`
3. Reproduce the reported steps.
4. Capture: actual behavior, expected behavior, console errors.
5. Post a reproduction comment on the issue.

If you cannot reproduce after one honest attempt, stop and ask.

## Stage 3 — Brainstorm (only if open questions)

If the issue has unresolved approach questions → invoke `/compound-engineering:ce:brainstorm`.
No open questions → skip to Stage 4.

## Stage 4 — Plan

Invoke `/compound-engineering:ce:plan`. The plan should:
- List concrete files to touch.
- Call out acceptance criteria from the issue.
- Note any Supabase schema changes or API changes needed.

Skip for trivial one-file changes (≤10 lines) — say so explicitly.

## Stage 5 — Implement

Invoke `/compound-engineering:ce:work` to execute the plan. Stay in scope only.

## Stage 6 — Run checks

- `npm run build` (catches type + import errors)
- Verify the fix in the browser at `http://localhost:4321`
- For auth-related changes: test with a real Supabase session

Do not push broken code.

## Stage 7 — Review

Invoke `/code-review` on the diff. Address findings inline.

## Stage 8 — Capture learnings

Invoke `/compound-engineering:ce:compound` to document anything reusable. Skip only for purely mechanical changes.

## Stage 9 — Push & close

Commit with `Closes #<num>` or `Fixes #<num>` in the message. Push to main.

Close the issue:
```bash
gh issue close <num> --repo josepharcillas/arcistocksph --comment "Resolved in <commit-sha>. <one-line summary>."
```

---

## Guardrails

- **Stay in scope.** Issue body defines done. File new issues for related problems.
- **Don't skip bug reproduction.** Fixing unreproduced bugs causes regressions.
- **Don't skip checks.** Green local build is the minimum bar.
- **Confirm before irreversible actions** (push to main, close issue).
- **Check CLAUDE.md** for project conventions before coding.
