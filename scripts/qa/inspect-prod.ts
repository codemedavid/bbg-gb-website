// Read-only pre-flight for the 0013 catch-up. Reports what is missing and
// whether the 0011 check constraint could be added without violating data.
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

const sql = postgres(url, { max: 1 });

try {
  const cols = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema='public' and (
      (table_name='products' and column_name like 'gb_%') or
      (table_name='products' and column_name='is_group_buy') or
      (table_name='group_buys' and column_name='product_id'))`;
  console.log('0013 columns already present:', cols.length ? cols.map((c) => `${c.table_name}.${c.column_name}`) : 'NONE');

  const cons = await sql<{ conname: string }[]>`
    select conname from pg_constraint where conname='group_buys_claimed_within_cap'`;
  console.log('0011 check constraint present:', cons.length > 0);

  const [bad] = await sql<{ n: number }[]>`
    select count(*)::int as n from group_buys where claimed_slots > total_slots`;
  console.log('group_buys rows that would violate the cap:', bad.n);

  const counts = await sql<{ t: string; n: number }[]>`
    select 'products' as t, count(*)::int as n from products
    union all select 'group_buys', count(*)::int from group_buys
    union all select 'orders', count(*)::int from orders
    union all select 'moq_campaigns', count(*)::int from moq_campaigns
    union all select 'users', count(*)::int from users`;
  console.log('row counts:', Object.fromEntries(counts.map((c) => [c.t, c.n])));
} finally {
  await sql.end();
}
