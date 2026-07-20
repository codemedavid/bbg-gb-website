// Compares what schema.ts declares against what a database actually has.
//
// The test harness rebuilds every table from schema.ts, so a deployed database
// that is behind its migrations stays invisible to the suite. This module is the
// pure half of the guard that closes that gap; scripts/check-schema.ts reflects a
// live database and feeds it in.
//
// Only *missing* things count as drift. A column the database still carries but
// the schema has dropped breaks nothing at runtime, so it is not a deploy blocker.

export type SchemaShape = {
  /** table name -> column names */
  tables: Record<string, string[]>;
  /** enum type name -> labels */
  enums: Record<string, string[]>;
};

export type SchemaDrift = {
  hasDrift: boolean;
  missingTables: string[];
  /** "table.column" */
  missingColumns: string[];
  /** "enum_type.label" */
  missingEnumValues: string[];
};

export function diffSchema(expected: SchemaShape, actual: SchemaShape): SchemaDrift {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  for (const [table, columns] of Object.entries(expected.tables)) {
    const live = actual.tables[table];
    // A missing table is reported once — listing each of its columns separately
    // would bury the single fact that matters.
    if (!live) {
      missingTables.push(table);
      continue;
    }
    const present = new Set(live);
    for (const column of columns) {
      if (!present.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  const missingEnumValues: string[] = [];
  for (const [type, labels] of Object.entries(expected.enums)) {
    const present = new Set(actual.enums[type] ?? []);
    for (const label of labels) {
      if (!present.has(label)) missingEnumValues.push(`${type}.${label}`);
    }
  }

  return {
    hasDrift: missingTables.length > 0 || missingColumns.length > 0 || missingEnumValues.length > 0,
    missingTables,
    missingColumns,
    missingEnumValues,
  };
}

const section = (title: string, items: string[]): string[] =>
  items.length ? [`${title}:`, ...items.map((i) => `  - ${i}`)] : [];

export function formatDrift(drift: SchemaDrift): string {
  if (!drift.hasDrift) return 'Database matches schema.ts — no drift.';
  return [
    'Database is behind schema.ts. The running code expects things this database does not have:',
    '',
    ...section('Missing tables', drift.missingTables),
    ...section('Missing columns', drift.missingColumns),
    ...section('Missing enum values', drift.missingEnumValues),
    '',
    'Apply the pending migrations (`npm run db:push`) before deploying.',
  ].join('\n');
}
