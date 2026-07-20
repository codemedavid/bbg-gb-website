// Reads the shape schema.ts declares, straight off the Drizzle builders the app
// itself imports, so the drift guard can never compare against a stale copy.
import { getTableConfig, isPgEnum } from 'drizzle-orm/pg-core';
import type { SchemaShape } from './drift';
import * as schema from './schema';

export function declaredShape(): SchemaShape {
  const shape: SchemaShape = { tables: {}, enums: {} };

  for (const value of Object.values(schema) as unknown[]) {
    if (value == null) continue;

    // pgEnum returns a *callable* carrying enumName/enumValues — an early version
    // of this filtered on `typeof value === 'object'` and silently dropped all of
    // them, which is exactly the drift that broke production. isPgEnum is
    // drizzle's own brand check, so it stays correct across shapes.
    if (isPgEnum(value)) {
      shape.enums[value.enumName] = [...value.enumValues];
      continue;
    }
    if (typeof value !== 'object') continue;

    try {
      const config = getTableConfig(value as never);
      shape.tables[config.name] = config.columns.map((c) => c.name);
    } catch {
      // Not a table builder — plain constants and helpers share this namespace.
    }
  }

  return shape;
}
