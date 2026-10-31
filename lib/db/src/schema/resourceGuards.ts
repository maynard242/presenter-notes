import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** One durable row per authenticated owner; request and write windows are independent. */
export const resourceGuardsTable = pgTable("resource_guards", {
  userId: text("user_id").primaryKey(),
  requestWindow: timestamp("request_window", { withTimezone: true }).notNull().default(sql`date_trunc('minute', statement_timestamp())`),
  requestCount: bigint("request_count", { mode: "bigint" }).notNull().default(0n),
  writeWindow: timestamp("write_window", { withTimezone: true }).notNull().default(sql`date_trunc('minute', statement_timestamp())`),
  writeCount: bigint("write_count", { mode: "bigint" }).notNull().default(0n),
});
