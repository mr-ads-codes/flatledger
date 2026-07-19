import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pinHash: text("pin_hash").notNull(),
  color: text("color").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  amount: integer("amount").notNull(),
  category: text("category").notNull(),
  paidBy: text("paid_by").notNull(),
  expenseDate: text("expense_date").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const expenseParticipants = sqliteTable("expense_participants", {
  expenseId: text("expense_id").notNull(),
  memberId: text("member_id").notNull(),
}, table => [primaryKey({ columns: [table.expenseId, table.memberId] })]);

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  fromMember: text("from_member").notNull(),
  toMember: text("to_member").notNull(),
  amount: integer("amount").notNull(),
  settlementDate: text("settlement_date").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  memberId: text("member_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
