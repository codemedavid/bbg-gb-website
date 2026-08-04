// Read-only: how is the deployed database tracking migrations, if at all?
import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const t = await sql<{ table_schema: string; table_name: string }[]>`
    select table_schema, table_name from information_schema.tables
    where table_name like '%drizzle%' or table_schema = 'drizzle'`;
  console.log('drizzle bookkeeping tables:', t.length ? t : 'NONE');
  for (const row of t) {
    const rows = await sql.unsafe(`select * from "${row.table_schema}"."${row.table_name}" order by 1`);
    console.log(`  ${row.table_schema}.${row.table_name}: ${rows.length} row(s)`);
    console.log(rows);
  }
  await sql.end();
}
main();
