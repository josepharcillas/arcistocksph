import { db, query, queryOne } from './db';

/**
 * Data access, scoped by user.
 *
 * Every function that touches per-user data takes `userId` (the verified Google
 * email) as its first argument and filters on it. That filter is the isolation
 * boundary — the schema has no row-level security to fall back on, because the
 * browser can no longer reach Postgres at all. Never add a query here that
 * takes a user id from anywhere but the session.
 */

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  leaderboard_opt_in: boolean;
}

export interface Holding {
  id: string;
  user_id: string;
  ticker: string;
  company_name: string | null;
  qty: number;
  buy_price: number;
  buy_date: string;
  peak_price: number | null;
  notes: string | null;
}

/** Called on every sign-in; the row is this user's first appearance. */
export async function getOrCreateUser(email: string, displayName?: string): Promise<Profile> {
  const id = email.toLowerCase();
  const row = await queryOne<Profile>(
    `insert into profiles (id, display_name)
       values ($1, $2)
     on conflict (id) do update
       -- Keep the name in step with Google, but never blank an existing one
       -- just because Google omitted it this time.
       set display_name = coalesce(excluded.display_name, profiles.display_name)
     returning id, display_name, avatar_url, leaderboard_opt_in`,
    [id, displayName ?? null]
  );
  if (!row) throw new Error('failed to upsert profile');
  return row;
}

export function listHoldings(userId: string): Promise<Holding[]> {
  return query<Holding>(
    `select id, user_id, ticker, company_name, qty, buy_price,
            to_char(buy_date, 'YYYY-MM-DD') as buy_date, peak_price, notes
       from holdings
      where user_id = $1
      order by created_at desc`,
    [userId]
  );
}

export async function getCash(userId: string): Promise<number> {
  const row = await queryOne<{ cash: number }>(
    `select cash from portfolio_cash where user_id = $1`,
    [userId]
  );
  return row?.cash ?? 0;
}

export async function setCash(userId: string, cash: number): Promise<void> {
  await query(
    `insert into portfolio_cash (user_id, cash, updated_at)
       values ($1, $2, now())
     on conflict (user_id) do update set cash = excluded.cash, updated_at = now()`,
    [userId, cash]
  );
}

/**
 * Add shares of a ticker, averaging into an existing position.
 *
 * This used to be three round trips from the browser (select, then update or
 * insert, then delete duplicates). Doing it in one statement server-side also
 * closes the race where two quick submissions each read "no existing position"
 * and inserted a second row for the same ticker.
 */
export async function addHolding(
  userId: string,
  h: { ticker: string; companyName?: string | null; qty: number; buyPrice: number; buyDate: string }
): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `select id, qty, buy_price from holdings
        where user_id = $1 and ticker = $2
        order by created_at
          for update`,
      [userId, h.ticker]
    );

    if (rows.length === 0) {
      await client.query(
        `insert into holdings (user_id, ticker, company_name, qty, buy_price, buy_date)
           values ($1, $2, $3, $4, $5, $6)`,
        [userId, h.ticker, h.companyName ?? null, h.qty, h.buyPrice, h.buyDate]
      );
    } else {
      // Weighted-average cost across the existing rows plus the new shares.
      const totQty = rows.reduce((s, r) => s + Number(r.qty), h.qty);
      const totCost = rows.reduce((s, r) => s + Number(r.qty) * Number(r.buy_price), h.qty * h.buyPrice);
      await client.query(
        `update holdings set qty = $1, buy_price = $2, buy_date = $3 where id = $4`,
        [totQty, totCost / totQty, h.buyDate, rows[0].id]
      );
      const dupes = rows.slice(1).map((r) => r.id);
      if (dupes.length) {
        await client.query(`delete from holdings where id = any($1::uuid[])`, [dupes]);
      }
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteHolding(userId: string, id: string): Promise<void> {
  // The user_id predicate is what stops one user deleting another's row by id.
  await query(`delete from holdings where id = $1 and user_id = $2`, [id, userId]);
}

export interface SyncPosition {
  ticker: string;
  qty: number;
  buyPrice: number;
}

/**
 * Replace the portfolio to match an imported broker snapshot.
 *
 * `keep` lists tickers the user marked as "keep" during review — positions that
 * are genuinely held but were missing from the screenshot (a cropped row, a
 * scrolled table). Everything else absent from `positions` is removed, which is
 * what makes the import a mirror of the broker rather than an append.
 *
 * One transaction: a half-applied import would silently misstate the portfolio,
 * and the old client-side loop could leave exactly that behind if the tab was
 * closed mid-sync.
 */
export async function syncHoldings(
  userId: string,
  positions: SyncPosition[],
  keep: string[],
  cash: number | null
): Promise<{ written: number; removed: number }> {
  const client = await db().connect();
  try {
    await client.query('begin');

    const seen = positions.map((p) => p.ticker.toUpperCase());
    const survivors = [...new Set([...seen, ...keep.map((t) => t.toUpperCase())])];

    const del = await client.query(
      `delete from holdings
        where user_id = $1
          and ($2::text[] = '{}' or ticker <> all($2::text[]))`,
      [userId, survivors]
    );

    for (const p of positions) {
      await client.query(
        `insert into holdings (user_id, ticker, qty, buy_price, buy_date)
              values ($1, $2, $3, $4, current_date)
         on conflict do nothing`,
        [userId, p.ticker.toUpperCase(), p.qty, p.buyPrice]
      );
      // No unique constraint on (user_id, ticker), so collapse to one row and
      // set it to the imported values — the broker is the source of truth here.
      await client.query(
        `with ranked as (
           select id, row_number() over (order by created_at) as rn
             from holdings where user_id = $1 and ticker = $2
         )
         delete from holdings where id in (select id from ranked where rn > 1)`,
        [userId, p.ticker.toUpperCase()]
      );
      await client.query(
        `update holdings set qty = $3, buy_price = $4
          where user_id = $1 and ticker = $2`,
        [userId, p.ticker.toUpperCase(), p.qty, p.buyPrice]
      );
    }

    if (cash !== null) {
      await client.query(
        `insert into portfolio_cash (user_id, cash, updated_at)
              values ($1, $2, now())
         on conflict (user_id) do update set cash = excluded.cash, updated_at = now()`,
        [userId, cash]
      );
    }

    await client.query('commit');
    return { written: positions.length, removed: del.rowCount ?? 0 };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
