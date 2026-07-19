const SESSION_COOKIE = "flatledger_session";
const ADMIN_ID = "m1";
const colors = ["#7457e8", "#e86f51", "#2d9f78", "#e0a629", "#4285d4", "#c35391", "#725a48", "#63708f"];

type MemberRow = { id: string; name: string; color: string; active: number; is_admin: number };
type SessionMember = MemberRow | null;

function response(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers });
}

function makeId() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

async function hashPin(pin: string) {
  const bytes = new TextEncoder().encode(`flatledger:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function initializeDatabase() {
  const { env } = await import("cloudflare:workers");
  const db = env.DB;
  if (!db) throw new Error("D1 database binding is unavailable");
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, pin_hash TEXT NOT NULL, color TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount INTEGER NOT NULL, category TEXT NOT NULL, paid_by TEXT NOT NULL, expense_date TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS expense_participants (expense_id TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (expense_id, member_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, from_member TEXT NOT NULL, to_member TEXT NOT NULL, amount INTEGER NOT NULL, settlement_date TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (expense_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS participants_expense_idx ON expense_participants (expense_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)"),
  ]);

  const count = await db.prepare("SELECT COUNT(*) AS count FROM members").first<{ count: number }>();
  if (!count?.count) {
    const now = new Date().toISOString();
    const seeds = [
      [ADMIN_ID, "Abdul", "1234", colors[0], 1],
      ["m2", "Friend 2", "2345", colors[1], 0],
      ["m3", "Friend 3", "3456", colors[2], 0],
      ["m4", "Friend 4", "4567", colors[3], 0],
      ["m5", "Friend 5", "5678", colors[4], 0],
      ["m6", "Friend 6", "6789", colors[5], 0],
    ] as const;
    await db.batch(await Promise.all(seeds.map(async ([id, name, pin, color, admin]) =>
      db.prepare("INSERT INTO members (id, name, pin_hash, color, active, is_admin, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
        .bind(id, name, await hashPin(pin), color, admin, now)
    )));
  }
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Date.now()).run();
  return db;
}

async function authenticatedMember(request: Request): Promise<SessionMember> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const { env } = await import("cloudflare:workers");
  return (await env.DB.prepare("SELECT m.id, m.name, m.color, m.active, m.is_admin FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = ? AND s.expires_at > ? AND m.active = 1")
    .bind(token, Date.now()).first<MemberRow>()) ?? null;
}

async function statePayload(currentUser: SessionMember) {
  const { env } = await import("cloudflare:workers");
  const db = env.DB;
  const profilesResult = await db.prepare("SELECT id, name, color, active, is_admin FROM members ORDER BY created_at").all<MemberRow>();
  const profiles = profilesResult.results.map(member => ({ id: member.id, name: member.name, color: member.color, active: Boolean(member.active), isAdmin: Boolean(member.is_admin) }));
  if (!currentUser) return { authenticated: false, members: profiles.filter(member => member.active) };

  const expenseResult = await db.prepare("SELECT id, title, amount, category, paid_by, expense_date, created_by FROM expenses ORDER BY expense_date, created_at").all<Record<string, string | number>>();
  const participantResult = await db.prepare("SELECT expense_id, member_id FROM expense_participants").all<{ expense_id: string; member_id: string }>();
  const participantMap = new Map<string, string[]>();
  participantResult.results.forEach(row => participantMap.set(row.expense_id, [...(participantMap.get(row.expense_id) ?? []), row.member_id]));
  const settlementResult = await db.prepare("SELECT id, from_member, to_member, amount, settlement_date, created_by FROM settlements ORDER BY settlement_date, created_at").all<Record<string, string | number>>();

  return {
    authenticated: true,
    currentUser: { id: currentUser.id, name: currentUser.name, color: currentUser.color, isAdmin: Boolean(currentUser.is_admin) },
    members: profiles,
    expenses: expenseResult.results.map(row => ({ id: row.id, title: row.title, amount: row.amount, category: row.category, paidBy: row.paid_by, date: row.expense_date, createdBy: row.created_by, participants: participantMap.get(String(row.id)) ?? [] })),
    settlements: settlementResult.results.map(row => ({ id: row.id, from: row.from_member, to: row.to_member, amount: row.amount, date: row.settlement_date, createdBy: row.created_by })),
  };
}

export async function GET(request: Request) {
  try {
    await initializeDatabase();
    return response(await statePayload(await authenticatedMember(request)));
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to load FlatLedger" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const db = await initializeDatabase();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "login") {
      const memberId = String(body.memberId ?? "");
      const pin = String(body.pin ?? "");
      const member = await db.prepare("SELECT id, pin_hash, active FROM members WHERE id = ?").bind(memberId).first<{ id: string; pin_hash: string; active: number }>();
      if (!member?.active || member.pin_hash !== await hashPin(pin)) return response({ error: "Incorrect PIN" }, 401);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const maxAge = 60 * 60 * 24 * 30;
      await db.prepare("INSERT INTO sessions (token, member_id, expires_at) VALUES (?, ?, ?)").bind(token, member.id, Date.now() + maxAge * 1000).run();
      return response({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, token, maxAge) });
    }

    if (action === "logout") {
      const token = cookieValue(request, SESSION_COOKIE);
      if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return response({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
    }

    const user = await authenticatedMember(request);
    if (!user) return response({ error: "Please sign in again" }, 401);
    const isAdmin = Boolean(user.is_admin);

    if (action === "saveExpense") {
      const item = body.expense as Record<string, unknown>;
      const id = String(item.id || makeId());
      const existing = await db.prepare("SELECT created_by FROM expenses WHERE id = ?").bind(id).first<{ created_by: string }>();
      if (existing && !isAdmin && existing.created_by !== user.id) return response({ error: "You cannot edit this expense" }, 403);
      const title = String(item.title ?? "").trim();
      const amount = Math.round(Number(item.amount));
      const category = String(item.category ?? "Other");
      const paidBy = String(item.paidBy ?? "");
      const date = String(item.date ?? "");
      const participants = Array.from(new Set((item.participants as unknown[] ?? []).map(String)));
      if (!title || !Number.isFinite(amount) || amount <= 0 || !paidBy || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !participants.length) return response({ error: "Please complete all expense fields" }, 400);
      const now = new Date().toISOString();
      const statements = existing
        ? [db.prepare("UPDATE expenses SET title = ?, amount = ?, category = ?, paid_by = ?, expense_date = ?, updated_at = ? WHERE id = ?").bind(title, amount, category, paidBy, date, now, id)]
        : [db.prepare("INSERT INTO expenses (id, title, amount, category, paid_by, expense_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, title, amount, category, paidBy, date, user.id, now, now)];
      statements.push(db.prepare("DELETE FROM expense_participants WHERE expense_id = ?").bind(id));
      participants.forEach(memberId => statements.push(db.prepare("INSERT INTO expense_participants (expense_id, member_id) VALUES (?, ?)").bind(id, memberId)));
      await db.batch(statements);
    } else if (action === "deleteExpense") {
      const id = String(body.id ?? "");
      const existing = await db.prepare("SELECT created_by FROM expenses WHERE id = ?").bind(id).first<{ created_by: string }>();
      if (!existing || (!isAdmin && existing.created_by !== user.id)) return response({ error: "You cannot delete this expense" }, 403);
      await db.batch([db.prepare("DELETE FROM expense_participants WHERE expense_id = ?").bind(id), db.prepare("DELETE FROM expenses WHERE id = ?").bind(id)]);
    } else if (action === "addSettlement") {
      const item = body.settlement as Record<string, unknown>;
      const to = String(item.to ?? "");
      const amount = Math.round(Number(item.amount));
      if (!to || to === user.id || !Number.isFinite(amount) || amount <= 0) return response({ error: "Invalid settlement" }, 400);
      await db.prepare("INSERT INTO settlements (id, from_member, to_member, amount, settlement_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(makeId(), user.id, to, amount, new Date().toISOString().slice(0, 10), user.id, new Date().toISOString()).run();
    } else if (["addMember", "updateMember", "toggleMember"].includes(action)) {
      if (!isAdmin) return response({ error: "Only Abdul can manage members" }, 403);
      if (action === "addMember") {
        const name = String(body.name ?? "").trim(); const pin = String(body.pin ?? "");
        if (!name || !/^\d{4}$/.test(pin)) return response({ error: "Enter a name and four-digit PIN" }, 400);
        const count = await db.prepare("SELECT COUNT(*) AS count FROM members").first<{ count: number }>();
        await db.prepare("INSERT INTO members (id, name, pin_hash, color, active, is_admin, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)").bind(makeId(), name, await hashPin(pin), colors[(count?.count ?? 0) % colors.length], new Date().toISOString()).run();
      } else if (action === "updateMember") {
        const id = String(body.id ?? ""); const name = String(body.name ?? "").trim(); const pin = String(body.pin ?? "");
        if (!name) return response({ error: "Member name is required" }, 400);
        if (pin && !/^\d{4}$/.test(pin)) return response({ error: "PIN must contain four digits" }, 400);
        if (pin) await db.prepare("UPDATE members SET name = ?, pin_hash = ? WHERE id = ?").bind(name, await hashPin(pin), id).run();
        else await db.prepare("UPDATE members SET name = ? WHERE id = ?").bind(name, id).run();
      } else {
        const id = String(body.id ?? ""); const active = Boolean(body.active);
        if (id === ADMIN_ID && !active) return response({ error: "Abdul cannot be removed" }, 400);
        await db.prepare("UPDATE members SET active = ? WHERE id = ?").bind(active ? 1 : 0, id).run();
        if (!active) await db.prepare("DELETE FROM sessions WHERE member_id = ?").bind(id).run();
      }
    } else return response({ error: "Unknown action" }, 400);

    return response(await statePayload(user));
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "FlatLedger request failed" }, 500);
  }
}
