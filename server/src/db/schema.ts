import { bigserial, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ipConnectionLog = pgTable(
  "ip_connection_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    wallet: text("wallet").notNull(),
    city: text("city"),
    country: text("country"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ipIdx: index("ip_connection_log_ip_idx").on(table.ip),
    walletIdx: index("ip_connection_log_wallet_idx").on(table.wallet),
    connectedAtIdx: index("ip_connection_log_connected_at_idx").on(
      table.connectedAt,
    ),
  }),
);

export type IpConnectionLog = typeof ipConnectionLog.$inferSelect;
export type NewIpConnectionLog = typeof ipConnectionLog.$inferInsert;
