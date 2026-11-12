// =============================================================================
// TRIAL: Supabase data fetcher for local testing
// Usage: import { testSupabaseData } from './utils/useSupabaseData.js';
//
// This does NOT replace any existing imports in App.jsx.
// Add a temporary useEffect in App.jsx to call testSupabaseData() and check
// the browser console — see TRIAL_INSTRUCTIONS.md for details.
// =============================================================================

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Fetch all data_snapshots from Supabase and return them in the same shape
 * that the current data.js imports produce.
 *
 * Returns an object where each key matches an export from data.js:
 *   { monthly, weekly, daily, salesreps, kpi (with totalClients, etc.), ... }
 *
 * Scalar KPI values are available both under d.kpi.totalClients AND d.totalClients.
 */
export async function fetchSupabaseData() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in your .env file'
    );
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/data_snapshots?select=key,data`;

  const resp = await fetch(endpoint, {
    headers: {
      'apikey':         SUPABASE_ANON_KEY,
      'Authorization':  `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase fetch failed: HTTP ${resp.status} — ${text}`);
  }

  const rows = await resp.json();

  // Build flat object: { monthly: [...], weekly: [...], kpi: {...}, ... }
  const d = {};
  rows.forEach(({ key, data }) => { d[key] = data; });

  // Spread kpi scalars to top level for backwards-compat with current App.jsx
  // (totalClients, lastUpdated, maxFactuurDatum, openOrderValueFuture, etc.)
  if (d.kpi) {
    Object.assign(d, d.kpi);
  }

  // debtorAsOf: stored as {value: "2026-10-28"} → unwrap
  if (d.debtorAsOf && typeof d.debtorAsOf === 'object' && 'value' in d.debtorAsOf) {
    d.debtorAsOf = d.debtorAsOf.value;
  }

  return d;
}

/**
 * Quick smoke-test function — call from a temporary useEffect in App.jsx.
 * Logs key counts and a few spot checks to the browser console.
 */
export async function testSupabaseData() {
  try {
    const d = await fetchSupabaseData();
    console.group('[SUPABASE TEST]');
    console.log('Keys loaded:', Object.keys(d).length);
    console.log('monthly rows:', d.monthly?.length ?? 'MISSING');
    console.log('daily rows:  ', d.daily?.length   ?? 'MISSING');
    console.log('weekly rows: ', d.weekly?.length   ?? 'MISSING');
    console.log('salesreps rows:', d.salesreps?.length ?? 'MISSING');
    console.log('debtorCustomers rows:', d.debtorCustomers?.length ?? 'MISSING');
    console.log('totalClients:', d.totalClients);
    console.log('lastUpdated:', d.lastUpdated);
    console.log('maxFactuurDatum:', d.maxFactuurDatum);
    console.log('turnoverMTD:', d.turnoverMTD);
    console.log('kpi object:', d.kpi);
    console.groupEnd();
    return d;
  } catch (err) {
    console.error('[SUPABASE TEST] Error:', err);
    return null;
  }
}

/**
 * Production-ready React hook (for use after the trial is confirmed working).
 * Uses sessionStorage to cache data for the browser session — one fetch per tab.
 * Falls back to empty arrays/nulls so the app renders without crashing if fetch fails.
 */
export function useSupabaseData() {
  const [data, setData]       = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState(null);

  React.useEffect(() => {
    const CACHE_KEY = 'dairytop_supabase_cache';
    const cached    = (() => {
      try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch { return null; }
    })();

    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    fetchSupabaseData()
      .then((d) => {
        setData(d);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {}
        setLoading(false);
      })
      .catch((err) => {
        console.error('[useSupabaseData]', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { data, loading, error };
}