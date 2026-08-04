// Read-only post-import verification of the database behind DATABASE_URL.
import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const counts = await sql`select 'products' t, count(*)::int n from products
    union all select 'orders', count(*)::int from orders
    union all select 'users', count(*)::int from users
    union all select 'group_buys', count(*)::int from group_buys
    union all select 'order_items', count(*)::int from order_items`;
  console.log('row counts:', Object.fromEntries(counts.map((r: any) => [r.t, r.n])));

  const spot = await sql`select name, spec, price_php, price_usd, is_group_buy, stock
    from products where code in ('BBG1000-100','NJ1000','TS10') or name = 'Lemon Bottle (China)'
    order by name`;
  console.table(spot);

  const orphan = await sql`select count(*)::int n from products where category_id is null`;
  console.log('products with no category:', orphan[0].n);
  await sql.end();
}
main();
