# Brainstorm: Philippine Stock Advisor

**Date:** 2026-05-28  
**Status:** Draft

---

## What We're Building

A web tool inside arcitools that helps Filipino investors decide when to **buy**, **hold**, or **sell** PSE-listed stocks. Users log in with Google, track their portfolio, and get AI-generated rationale for each recommendation — in plain English or Filipino.

The AI engine is provider-agnostic: it auto-switches between **Gemini** and **Groq** depending on which API key is configured, with easy extensibility for Claude or OpenAI later.

---

## Core Features

| Feature | Description |
|---|---|
| **Stock Screener** | Filter PSE stocks by basic criteria (sector, price range); AI ranks and explains top picks |
| **Buy Signals** | AI analyzes price history + technicals and recommends entry points |
| **Sell Signals** | Alerts when a held stock hits stop-loss, target price, or AI-detected reversal |
| **Portfolio Watchlist** | User adds holdings (ticker, qty, buy price); tracked persistently |
| **AI Rationale** | Natural-language buy/sell/hold explanation per stock, beginner-friendly |

---

## Target Users

All experience levels — beginner investors who need guidance, active traders who want signals, and long-term holders who want fundamental health checks. The AI tone adapts based on the explanation it generates (not a separate mode toggle).

---

## Why This Approach

**Stack:** Extend existing arcitools (Astro + React + TypeScript + Tailwind CSS 4)  
**Auth:** Google OAuth — fits arcitools' Filipino audience, same Google Cloud project as Gemini API  
**Database:** Supabase (Postgres) — free tier sufficient for portfolio storage; handles auth + data in one service  
**Market Data:** Yahoo Finance unofficial API (`.PS` suffix for PSE stocks) — free, no key needed, ~15-min delay acceptable  
**AI:** Configurable provider abstraction:
  1. Check `GEMINI_API_KEY` → use Gemini 1.5 Flash (1,500 free req/day)
  2. Else check `GROQ_API_KEY` → use Groq (free rate-limited tier)
  3. Both set → Gemini primary, Groq fallback
  4. Extensible: add Claude/OpenAI by adding a key

---

## Key Decisions

1. **AI provider abstraction layer** — single `analyzeStock(prompt, data)` function, swappable backend via env keys. No hard-coded provider.

2. **Free data first** — Yahoo Finance `.PS` covers all PSE-listed stocks with 15-min delay. Sufficient for daily/swing trading signals; not for intraday scalping.

3. **Google login via Supabase Auth** — Supabase supports Google OAuth out of the box. One service handles both auth and portfolio database.

4. **Technical analysis computed locally** — RSI, MACD, moving averages computed from raw price data before being sent to AI. Reduces token usage and gives AI structured inputs.

5. **Disclaimer required** — Must display "This is not financial advice" prominently. Arcitools' educational framing already sets this tone.

6. **Bilingual output** — AI prompt instructs model to respond in Filipino-friendly English (or Tagalog if user prefers), consistent with arcitools' bilingual standard.

---

## Data Flow

```
User views stock / portfolio
        ↓
Fetch price history from Yahoo Finance (.PS)
        ↓
Compute technicals (RSI, MACD, SMA) client-side or serverless
        ↓
Send structured data → AI provider (Gemini → Groq fallback)
        ↓
AI returns: verdict (BUY/SELL/HOLD) + rationale paragraph
        ↓
Display to user with disclaimer
```

---

## Resolved Questions

- **Auth method:** Google OAuth (via Supabase)
- **AI provider:** Gemini primary, Groq fallback, auto-switched by env key presence
- **Data source:** Yahoo Finance free API (.PS suffix for PSE stocks)
- **Portfolio persistence:** Supabase Postgres (not localStorage)
- **Analysis method:** AI-powered with pre-computed technicals as input

---

## PWA — Mobile App Experience

The webapp is built as a **Progressive Web App (PWA)**:

- **Installable** — "Add to Home Screen" on Android and iOS; runs full-screen like a native app
- **Push notifications** — sell/buy alerts sent to the phone even when the app is closed, via Web Push API + Firebase Cloud Messaging (FCM, free, same Google account)
- **Offline support** — portfolio and last-known prices cached via service worker
- **iOS note** — push requires Safari 16.4+ and the user must install the app to Home Screen first

**Implementation:** `vite-plugin-pwa` (works with Astro), FCM for notification delivery, Supabase serverless function triggers the push when a signal fires.

---

## Resolved Questions

- **Sell alerts:** PWA push notifications via FCM + in-app dashboard display
- **Stock coverage:** All ~300 PSE-listed stocks available; user can also add any custom ticker to their personal watchlist
- **Analysis data:** All three layers — technical indicators (RSI, MACD, SMA), fundamentals (P/E, EPS via PSE Edge scrape), and news sentiment (headlines fed to AI)
- **Paper trading:** Yes — users can open simulated positions to test AI signals before using real money
- **Leaderboard:** Public leaderboard showing top paper traders ranked by simulated portfolio performance. Adds gamification and social virality.
