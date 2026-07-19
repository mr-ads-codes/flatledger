"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Member = { id: string; name: string; color: string; active: boolean; isAdmin: boolean };
type CurrentUser = Pick<Member, "id" | "name" | "color" | "isAdmin">;
type Expense = { id: string; title: string; amount: number; category: string; paidBy: string; participants: string[]; date: string; createdBy: string };
type Settlement = { id: string; from: string; to: string; amount: number; date: string; createdBy: string };
type View = "dashboard" | "expenses" | "reports" | "settings";
type StatePayload = { authenticated: boolean; currentUser?: CurrentUser; members: Member[]; expenses?: Expense[]; settlements?: Settlement[]; error?: string };

const ADMIN_ID = "m1";
const money = (value: number) => `PKR ${Math.abs(value).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
const monthKey = () => new Date().toISOString().slice(0, 7);
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loginMember, setLoginMember] = useState<Member | null>(null);
  const [pin, setPin] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("dashboard");
  const [month, setMonth] = useState(monthKey());
  const [showExpense, setShowExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPin, setNewMemberPin] = useState("");

  function applyState(data: StatePayload) {
    setMembers(data.members ?? []);
    if (data.authenticated && data.currentUser) {
      setCurrentUser(data.currentUser);
      setExpenses(data.expenses ?? []);
      setSettlements(data.settlements ?? []);
    } else {
      setCurrentUser(null);
      setExpenses([]);
      setSettlements([]);
    }
  }

  async function loadState(silent = false) {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/flatledger", { cache: "no-store" });
      const data = await response.json() as StatePayload;
      if (!response.ok) throw new Error(data.error ?? "Unable to load FlatLedger");
      applyState(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load FlatLedger");
    } finally { if (!silent) setLoading(false); }
  }

  async function action(name: string, payload: Record<string, unknown> = {}) {
    setNotice("");
    const response = await fetch("/api/flatledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: name, ...payload }),
    });
    const data = await response.json() as StatePayload & { ok?: boolean };
    if (!response.ok) { setNotice(data.error ?? "Request failed"); throw new Error(data.error ?? "Request failed"); }
    if (data.members) applyState(data);
    return data;
  }

  useEffect(() => {
    // Initial remote synchronization starts after the component mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState();
    const timer = window.setInterval(() => void loadState(true), 15000);
    return () => window.clearInterval(timer);
    // loadState intentionally stays stable for this mount-only polling lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMembers = members.filter(member => member.active);
  const filtered = expenses.filter(expense => expense.date.startsWith(month));
  const filteredSettlements = settlements.filter(settlement => settlement.date.startsWith(month));
  const balances = useMemo(() => {
    const result: Record<string, number> = Object.fromEntries(members.map(member => [member.id, 0]));
    filtered.forEach(expense => {
      if (!expense.participants.length) return;
      const share = expense.amount / expense.participants.length;
      result[expense.paidBy] = (result[expense.paidBy] ?? 0) + expense.amount;
      expense.participants.forEach(id => { result[id] = (result[id] ?? 0) - share; });
    });
    filteredSettlements.forEach(settlement => {
      result[settlement.from] = (result[settlement.from] ?? 0) + settlement.amount;
      result[settlement.to] = (result[settlement.to] ?? 0) - settlement.amount;
    });
    return result;
  }, [filtered, filteredSettlements, members]);
  const total = filtered.reduce((sum, expense) => sum + expense.amount, 0);
  const balanceMembers = members.filter(member => member.active || Math.abs(balances[member.id] ?? 0) > 0.001);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!loginMember) return;
    try {
      await action("login", { memberId: loginMember.id, pin });
      setLoginMember(null); setPin(""); setView("dashboard");
      await loadState();
    } catch { /* notice is shown above the form */ }
  }

  async function logout() {
    await action("logout");
    setView("dashboard");
    await loadState();
  }

  if (loading) return <main className="login-shell"><div className="loading-card"><span className="brand-mark">F</span><strong>Opening FlatLedger…</strong></div></main>;
  if (!currentUser) return <main className="login-shell"><section className="login-card">
    <div className="brand"><span className="brand-mark">F</span><span>FlatLedger</span></div>
    {!loginMember ? <>
      <div className="login-copy"><span className="eyebrow">SHARED FLAT · {activeMembers.length} MEMBERS</span><h1>Who’s adding<br />an expense?</h1><p>Select your profile to continue.</p></div>
      {notice && <p className="alert">{notice}</p>}
      <div className="member-grid">{activeMembers.map(member => <button className="member-tile" key={member.id} onClick={() => { setLoginMember(member); setNotice(""); }}><span className="avatar" style={{ background: member.color }}>{member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.isAdmin ? "Administrator" : "Tap to sign in"}</small></span></button>)}</div>
      <p className="demo-note">Shared securely across all signed-in devices.</p>
    </> : <form className="pin-form" onSubmit={login}>
      <button type="button" className="back" onClick={() => { setLoginMember(null); setPin(""); setNotice(""); }}>← All profiles</button>
      <span className="avatar big" style={{ background: loginMember.color }}>{loginMember.name.slice(0, 1)}</span>
      <h1>Welcome, {loginMember.name}</h1><p>Enter your four-digit PIN</p>
      <input autoFocus inputMode="numeric" maxLength={4} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ""))} placeholder="••••" aria-label="Four digit PIN" />
      {notice && <p className="error">{notice}</p>}
      <button className="primary" disabled={pin.length !== 4}>Continue</button>
    </form>}
  </section></main>;

  const navItems: [View, string, string][] = [["dashboard", "Overview", "⌂"], ["expenses", "Expenses", "↗"], ["reports", "Monthly report", "▤"]];
  if (currentUser.isAdmin) navItems.push(["settings", "Members & PINs", "⚙"]);

  return <main className="app-shell">
    <aside><div className="brand"><span className="brand-mark">F</span><span>FlatLedger</span></div><nav>{navItems.map(([id, label, icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><span>{icon}</span>{label}</button>)}</nav><div className="profile"><span className="avatar mini" style={{ background: currentUser.color }}>{currentUser.name[0]}</span><div><strong>{currentUser.name}</strong><small>{currentUser.isAdmin ? "Administrator" : "Signed in"}</small></div><button aria-label="Sign out" onClick={() => void logout()}>↪</button></div></aside>
    <section className="content">
      <header><div><span className="eyebrow">SHARED HOME FINANCES</span><h1>{view === "dashboard" ? `Good evening, ${currentUser.name}` : view === "expenses" ? "All expenses" : view === "reports" ? "Monthly report" : "Members & PINs"}</h1><p>{view === "dashboard" ? "Everyone sees the same shared figures." : "Everything stays clear and accountable."}</p></div><div className="header-actions"><input type="month" value={month} onChange={event => setMonth(event.target.value)} /><button className="primary" onClick={() => { setEditingExpense(null); setShowExpense(true); }}>＋ Add expense</button></div></header>
      {notice && <div className="alert">{notice}</div>}

      {view === "dashboard" && <><div className="stat-grid"><article className="stat purple"><span>THIS MONTH</span><strong>{money(total)}</strong><small>{filtered.length} shared expenses</small></article><article className="stat"><span>YOUR BALANCE</span><strong className={(balances[currentUser.id] ?? 0) >= 0 ? "positive" : "negative"}>{(balances[currentUser.id] ?? 0) >= 0 ? "+" : "−"}{money(balances[currentUser.id] ?? 0)}</strong><small>{(balances[currentUser.id] ?? 0) >= 0 ? "You are owed" : "You owe the flat"}</small></article><article className="stat"><span>AVERAGE / ACTIVE MEMBER</span><strong>{money(total / Math.max(activeMembers.length, 1))}</strong><small>Across {activeMembers.length} current members</small></article></div><div className="dashboard-grid"><article className="panel"><div className="panel-head"><div><h2>Everyone’s balance</h2><p>Calculated from selected participants</p></div><button onClick={() => setShowSettle(true)}>Settle up</button></div><div className="balance-list">{balanceMembers.map(member => <div className="balance-row" key={member.id}><span className="avatar mini" style={{ background: member.color }}>{member.name[0]}</span><div className="balance-name"><strong>{member.name}{member.active ? "" : " (Former)"}</strong><small>{(balances[member.id] ?? 0) >= 0 ? "gets back" : "needs to pay"}</small></div><strong className={(balances[member.id] ?? 0) >= 0 ? "positive" : "negative"}>{(balances[member.id] ?? 0) >= 0 ? "+" : "−"}{money(balances[member.id] ?? 0)}</strong></div>)}</div></article><article className="panel"><div className="panel-head"><div><h2>Recent expenses</h2><p>Synced from the shared database</p></div><button onClick={() => setView("expenses")}>View all</button></div><ExpenseList expenses={filtered.slice(-5).reverse()} members={members} /></article></div></>}

      {view === "expenses" && <article className="panel wide"><div className="panel-head"><div><h2>{new Date(month + "-02").toLocaleDateString("en", { month: "long", year: "numeric" })}</h2><p>{filtered.length} entries · {money(total)} total</p></div></div><ExpenseList expenses={filtered.slice().reverse()} members={members} currentUser={currentUser} onEdit={expense => { setEditingExpense(expense); setShowExpense(true); }} onDelete={async id => { await action("deleteExpense", { id }); }} /></article>}

      {view === "reports" && <article className="panel wide report"><div className="report-title"><div><span className="eyebrow">MONTHLY SUMMARY</span><h2>{new Date(month + "-02").toLocaleDateString("en", { month: "long", year: "numeric" })}</h2></div><button onClick={() => window.print()}>Print / Save PDF</button></div><div className="report-total"><span>Total flat spending</span><strong>{money(total)}</strong></div><h3>Member breakdown</h3>{balanceMembers.map(member => <div className="report-row" key={member.id}><span>{member.name}{member.active ? "" : " (Former member)"}</span><strong className={(balances[member.id] ?? 0) >= 0 ? "positive" : "negative"}>{(balances[member.id] ?? 0) >= 0 ? "is owed " : "owes "}{money(balances[member.id] ?? 0)}</strong></div>)}</article>}

      {view === "settings" && currentUser.isAdmin && <article className="panel wide"><div className="panel-head"><div><h2>Current flat members</h2><p>Only Abdul can add, edit, remove or restore members.</p></div><span className="admin-badge">ADMIN ONLY</span></div><div className="settings-list">{activeMembers.map(member => <MemberEditor key={member.id} member={member} onSave={async (name, pin) => { await action("updateMember", { id: member.id, name, pin }); }} onRemove={member.id === ADMIN_ID ? undefined : async () => { await action("toggleMember", { id: member.id, active: false }); }} />)}</div><form className="add-member" onSubmit={async event => { event.preventDefault(); try { await action("addMember", { name: newMemberName, pin: newMemberPin }); setNewMemberName(""); setNewMemberPin(""); } catch { /* notice shown */ } }}><div><h3>Add a new member</h3><p>They receive a secure shared account.</p></div><input aria-label="New member name" value={newMemberName} onChange={event => setNewMemberName(event.target.value)} placeholder="Member name" /><input aria-label="New member PIN" inputMode="numeric" maxLength={4} value={newMemberPin} onChange={event => setNewMemberPin(event.target.value.replace(/\D/g, ""))} placeholder="4-digit PIN" /><button className="primary" disabled={!newMemberName.trim() || newMemberPin.length !== 4}>＋ Add member</button></form>{members.some(member => !member.active) && <div className="former-members"><h3>Former members</h3><p>Their historical expenses remain intact.</p>{members.filter(member => !member.active).map(member => <div key={member.id}><span className="avatar tiny" style={{ background: member.color }}>{member.name[0]}</span><span>{member.name}</span><button onClick={() => void action("toggleMember", { id: member.id, active: true })}>Restore</button></div>)}</div>}</article>}
    </section>

    {showExpense && <ExpenseModal members={editingExpense ? members.filter(member => member.active || editingExpense.participants.includes(member.id) || editingExpense.paidBy === member.id) : activeMembers} active={currentUser} expense={editingExpense} onClose={() => { setShowExpense(false); setEditingExpense(null); }} onSave={async expense => { await action("saveExpense", { expense }); setShowExpense(false); setEditingExpense(null); }} />}
    {showSettle && activeMembers.length > 1 && <SettleModal members={activeMembers} active={currentUser} onClose={() => setShowSettle(false)} onSave={async settlement => { await action("addSettlement", { settlement }); setShowSettle(false); }} />}
  </main>;
}

function MemberEditor({ member, onSave, onRemove }: { member: Member; onSave: (name: string, pin: string) => Promise<void>; onRemove?: () => Promise<void> }) {
  const [name, setName] = useState(member.name); const [pin, setPin] = useState(""); const [saving, setSaving] = useState(false);
  return <div className="setting-row"><span className="avatar mini" style={{ background: member.color }}>{member.name[0]}</span><input aria-label={`${member.name} name`} value={name} onChange={event => setName(event.target.value)} /><input aria-label={`New PIN for ${member.name}`} inputMode="numeric" maxLength={4} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ""))} placeholder="New PIN (optional)" /><button className="save-member" disabled={saving || !name.trim() || (pin.length > 0 && pin.length !== 4)} onClick={async () => { setSaving(true); try { await onSave(name, pin); setPin(""); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Save"}</button>{onRemove ? <button className="remove-member" onClick={() => void onRemove()}>Remove</button> : <span className="owner-label">Owner</span>}</div>;
}

function ExpenseList({ expenses, members, currentUser, onEdit, onDelete }: { expenses: Expense[]; members: Member[]; currentUser?: CurrentUser; onEdit?: (expense: Expense) => void; onDelete?: (id: string) => Promise<void> }) {
  if (!expenses.length) return <div className="empty"><span>⌁</span><strong>No expenses yet</strong><p>Add the first expense to begin this month.</p></div>;
  return <div className="expense-list">{expenses.map(expense => { const payer = members.find(member => member.id === expense.paidBy); const canChange = currentUser?.isAdmin || currentUser?.id === expense.createdBy; return <div className="expense-row" key={expense.id}><span className="expense-icon">{expense.category === "Food" ? "🍲" : expense.category === "Bills" ? "⚡" : expense.category === "Rent" ? "⌂" : "◈"}</span><div><strong>{expense.title}</strong><small>{new Date(expense.date + "T12:00").toLocaleDateString("en", { day: "numeric", month: "short" })} · {expense.participants.length} participants · paid by {payer?.name ?? "Former member"}</small></div><strong>{money(expense.amount)}</strong>{canChange && onEdit && <button className="edit-expense" aria-label={`Edit ${expense.title}`} onClick={() => onEdit(expense)}>✎</button>}{canChange && onDelete && <button className="delete" aria-label={`Delete ${expense.title}`} onClick={() => void onDelete(expense.id)}>×</button>}</div>; })}</div>;
}

function ExpenseModal({ members, active, expense, onClose, onSave }: { members: Member[]; active: CurrentUser; expense: Expense | null; onClose: () => void; onSave: (expense: Expense) => Promise<void> }) {
  const [title, setTitle] = useState(expense?.title ?? ""); const [amount, setAmount] = useState(expense ? String(expense.amount) : ""); const [category, setCategory] = useState(expense?.category ?? "Food"); const [paidBy, setPaidBy] = useState(expense?.paidBy ?? active.id); const [participants, setParticipants] = useState(expense?.participants ?? members.map(member => member.id)); const [date, setDate] = useState(expense?.date ?? new Date().toISOString().slice(0, 10)); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (!title.trim() || !amount || !participants.length) return; setSaving(true); try { await onSave({ id: expense?.id ?? makeId(), title: title.trim(), amount: Number(amount), category, paidBy, participants, date, createdBy: expense?.createdBy ?? active.id }); } finally { setSaving(false); } }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{expense ? "CORRECT ENTRY" : "NEW ENTRY"}</span><h2>{expense ? "Edit expense" : "Add an expense"}</h2></div><button type="button" onClick={onClose}>×</button></div><label>What was it for?<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Sunday dinner" /></label><div className="two-col"><label>Amount (PKR)<input type="number" min="1" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" /></label><label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option>Food</option><option>Bills</option><option>Rent</option><option>Groceries</option><option>Cleaning</option><option>Other</option></select></label></div><div className="two-col"><label>Paid by<select value={paidBy} onChange={event => setPaidBy(event.target.value)}>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div><fieldset><legend>Who participated?</legend><p>Select only the people sharing this expense.</p><div className="participant-grid">{members.map(member => <button type="button" key={member.id} className={participants.includes(member.id) ? "selected" : ""} onClick={() => setParticipants(participants.includes(member.id) ? participants.filter(id => id !== member.id) : [...participants, member.id])}><span className="avatar tiny" style={{ background: member.color }}>{member.name[0]}</span>{member.name}<i>{participants.includes(member.id) ? "✓" : ""}</i></button>)}</div></fieldset><div className="split-preview"><span>Split between {participants.length} people</span><strong>{participants.length && amount ? money(Number(amount) / participants.length) + " each" : "—"}</strong></div><button className="primary full" disabled={saving}>{saving ? "Saving…" : expense ? "Save changes" : "Save expense"}</button></form></div>;
}

function SettleModal({ members, active, onClose, onSave }: { members: Member[]; active: CurrentUser; onClose: () => void; onSave: (settlement: { to: string; amount: number }) => Promise<void> }) {
  const [to, setTo] = useState(members.find(member => member.id !== active.id)?.id ?? ""); const [amount, setAmount] = useState(""); const [saving, setSaving] = useState(false);
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal small" onSubmit={async event => { event.preventDefault(); if (!amount || !to) return; setSaving(true); try { await onSave({ to, amount: Number(amount) }); } finally { setSaving(false); } }} onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">RECORD PAYMENT</span><h2>Settle up</h2></div><button type="button" onClick={onClose}>×</button></div><label>You paid<select value={to} onChange={event => setTo(event.target.value)}>{members.filter(member => member.id !== active.id).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Amount (PKR)<input autoFocus type="number" min="1" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" /></label><button className="primary full" disabled={saving}>{saving ? "Saving…" : "Record settlement"}</button></form></div>;
}
