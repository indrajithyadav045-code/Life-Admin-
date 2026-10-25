import { pgTable, text, jsonb, index } from "drizzle-orm/pg-core";

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  dueDate: text("due_date"),
  amount: jsonb("amount").$type<{ value: number; currency: string }>(),
  details: text("details").notNull().default(""),
  sourceName: text("source_name"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
}, table => [index("tasks_user_id_idx").on(table.userId)]);
