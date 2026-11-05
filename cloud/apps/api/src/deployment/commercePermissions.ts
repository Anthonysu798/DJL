/** These runtime grants must agree with infra/postgres/policies.sql, after all migrations. */
export const COMMERCE_APPEND_ONLY_TABLES = [
  "commerce_ledger",
  "commerce_operations",
  "commerce_external_refund_allocations",
  "commerce_supplier_payment_documents",
] as const;
export const COMMERCE_STATE_HISTORY_TABLES = [
  "commerce_orders",
  "commerce_order_items",
  "commerce_commissions",
  "commerce_withdrawals",
  "commerce_payment_attempts",
  "commerce_provider_refunds",
  "commerce_payment_events",
  "commerce_external_refunds",
  "commerce_alert_incidents",
  "commerce_alert_email_deliveries",
] as const;
export const COMMERCE_RUNTIME_TABLES = [
  ...COMMERCE_APPEND_ONLY_TABLES,
  ...COMMERCE_STATE_HISTORY_TABLES,
];

export interface CommerceTablePrivileges {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
  readonly canTruncate: boolean;
  readonly ownsTable: boolean;
}

/** Fixed SQL with a bound table-name array; no request value is interpolated as SQL. */
export const COMMERCE_RUNTIME_PRIVILEGE_SQL = `
  select table_name as "tableName",
    has_table_privilege(current_user, 'public.' || table_name, 'SELECT') as "canSelect",
    has_table_privilege(current_user, 'public.' || table_name, 'INSERT') as "canInsert",
    has_table_privilege(current_user, 'public.' || table_name, 'UPDATE') as "canUpdate",
    has_table_privilege(current_user, 'public.' || table_name, 'DELETE') as "canDelete",
    has_table_privilege(current_user, 'public.' || table_name, 'TRUNCATE') as "canTruncate",
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name
        and pg_has_role(current_user, c.relowner, 'USAGE')) as "ownsTable"
  from unnest($1::text[]) as expected(table_name)
`;

export function assertCommerceRuntimePrivileges(rows: readonly CommerceTablePrivileges[]): void {
  const byTable = new Map(rows.map((row) => [row.tableName, row]));
  const immutable = new Set<string>(COMMERCE_APPEND_ONLY_TABLES);
  if (
    rows.length !== COMMERCE_RUNTIME_TABLES.length ||
    byTable.size !== rows.length ||
    COMMERCE_RUNTIME_TABLES.some((name) => {
      const row = byTable.get(name);
      return (
        !row ||
        row.canSelect !== true ||
        row.canInsert !== true ||
        row.canUpdate !== !immutable.has(name) ||
        row.canDelete !== false ||
        row.canTruncate !== false ||
        row.ownsTable !== false
      );
    })
  )
    throw new Error("Commerce runtime permissions do not match the accounting policy.");
}
