import { execFileSync } from 'node:child_process';

// Read-only checks against the LOCAL Supabase database container (never Cloud).
const DB_CONTAINER = 'supabase_db_rental-pos';

/** Runs one SQL query and returns rows as arrays of strings (psql unaligned, `|`-separated). */
export function sql(query: string): string[][] {
  const out = execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', query],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  return out.trim() === '' ? [] : out.trim().split('\n').map((line) => line.split('|'));
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Stock per state for one product SKU, e.g. { AVAILABLE: 98, RENTED_OUT: 1 }. */
export function stockBySku(sku: string): Record<string, number> {
  const rows = sql(`select s.stock_state, s.quantity from public.stock_balances s
    join public.products p on p.id = s.product_id where p.sku = ${lit(sku)}`);
  return Object.fromEntries(rows.map(([state, qty]) => [state, Number(qty)]));
}

export function billByNo(billNo: string) {
  const [row] = sql(`select status, payment_status, grand_total, paid_amount, balance_due
    from public.bills where bill_no = ${lit(billNo)}`);
  if (!row) return null;
  const [status, paymentStatus, grandTotal, paid, balance] = row;
  return { status, paymentStatus, grandTotal: Number(grandTotal), paid: Number(paid), balance: Number(balance) };
}
