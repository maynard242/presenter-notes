import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notesTable = pgTable("notes", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  event: text("event").notNull(),
  eventDate: text("event_date"),
  content: text("content").notNull(),
  tags: text("tags").array().notNull().default([]),
  filename: text("filename"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("notes_owner_list_idx").on(table.userId, table.eventDate.desc(), table.createdAt.desc(), table.id.desc()),
  index("notes_owner_updated_idx").on(table.userId, table.updatedAt.desc(), table.id.desc()),
]);

export const insertNoteSchema = createInsertSchema(notesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notesTable.$inferSelect;
