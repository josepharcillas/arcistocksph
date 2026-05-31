---
description: QA a page/feature against a structured checklist and log any bugs found as GitHub issues (bug label) on josepharcillas/arcistocksph.
argument-hint: <page path | URL | feature description>
---

You are running a structured QA pass on **$ARGUMENTS**. Your goal is to surface real defects and, with the user's go-ahead, file them as GitHub Issues with the `bug` label on `josepharcillas/arcistocksph`.

You do NOT fix bugs in this flow. You find them and log them.

## Step 1 — Resolve the target

Translate `$ARGUMENTS` into a concrete artifact:
- **Page path** (e.g. `/dashboard`, `/screener`) → read the matching file under `src/pages/`.
- **Feature** (e.g. "portfolio holdings", "AI signals", "paper trading") → find the relevant component in `src/components/`.
- **URL** → strip host, treat the path as a page path.

If ambiguous, list 2-3 candidates and ask which one. One question max.

## Step 2 — Read the source

Read the full page plus any React components or utilities it imports. Note:
- Data fetching logic (Supabase queries, API calls to `/api/stock/`, `/api/analyze`)
- Form inputs and their validation
- AI signal generation and display
- Auth protection (is the page behind middleware?)
- PWA / service worker behavior

## Step 3 — Run the QA checklist

### A. Functionality
- Does the core feature work end-to-end?
- Are loading states handled (skeleton screens)?
- Are error states handled (API failure, no data)?
- Are empty states handled (no holdings, no watchlist)?

### B. Data correctness
- Are PSE ticker formats consistent (no `.PS` suffix shown to user)?
- Are monetary values in PHP with ₱ symbol?
- Are P&L calculations correct (qty × (current - buy) / buy × 100)?
- Are AI signals displaying correct verdict badges (green BUY, red SELL, yellow HOLD)?

### C. Auth & security
- Are protected routes behind middleware?
- Is Supabase RLS enforced (users can't see others' data)?
- Are API keys never exposed to the client?

### D. UI / Mobile
- Does the layout work on mobile (360px)?
- Does the bottom nav work on mobile?
- Is the dark theme consistent (slate-950 bg, green/red accents)?
- Are disclaimers ("not financial advice") present on signal pages?

### E. PWA
- Does the web manifest load?
- Is the service worker registered?
- Does the install prompt appear on mobile?

### F. Performance
- Are stock data API calls cached (15 min for Yahoo Finance)?
- Are AI analysis calls cached (4 hours)?
- No unnecessary re-fetches on re-render?

## Step 4 — Present findings

```
QA: <target>
=============
BUGS (n):
  1. <category>: <one-line description>
NON-BUG NOTES (n):
  - <observation>
OK: <category list that passed>
```

Then ask: **"File the N bugs as issues? (y / pick numbers / n)"**

## Step 5 — File bugs as GitHub issues

```bash
ISSUE_JSON=$(gh api -X POST repos/josepharcillas/arcistocksph/issues \
  -f title="<verb-first title, ≤70 chars>" \
  -f body="$(cat <<'EOF'
## Found by /qa on <target>

**Category:** <A-F label>

**Reproduce:**
<concrete steps>

**Likely cause:**
<file:line if known>

## Original finding
<one-liner from Step 4>
EOF
)")
NUM=$(echo "$ISSUE_JSON" | jq -r '.number')

echo '{"labels":["bug"]}' | \
  gh api -X POST repos/josepharcillas/arcistocksph/issues/$NUM/labels --input -

gh issue view $NUM --repo josepharcillas/arcistocksph --json labels --jq '.labels | map(.name) | join(",")'
```

## Step 6 — Reply

One-line confirmation per filed issue:
```
#<n>: <title> [<verified-labels>] — <url>
```

Then: `Filed X of Y bugs. Z skipped.`

## Rules
- **Don't fix.** Find and file only.
- **Don't speculate** beyond what the source supports.
- **Be terse** in the findings report.
