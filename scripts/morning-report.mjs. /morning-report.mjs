// Command Deck · morning report → Telegram
// Reads tasks from Firebase (with a private service-account key kept in GitHub Secrets)
// and sends one summary message. Nothing here is secret; the keys live only in Secrets.

const TZ = "Asia/Kolkata";
const MAX_PER_SECTION = 15;

export function todayIn(tz = TZ, d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // YYYY-MM-DD
}
function addDays(s, n) { const [y, m, d] = s.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); }
function fmt(s) { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }); }
function dayOf(ms, tz = TZ) { return todayIn(tz, new Date(ms)); }
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export function buildReport(tasks, users, today, leads = []) {
  const name = uid => uid ? (users.find(u => u.id === uid)?.name || "Removed user") : "";
  const isDone = t => t.repeat === "daily" ? t.lastDone === today : !!t.done;
  const onTime = t => t.repeat !== "daily" && t.done && !(t.reschedules > 0) && (!t.due || !t.doneAt || dayOf(t.doneAt) <= t.due);
  const line = t => {
    const bits = [];
    if (t.firm) bits.push(t.firm);
    if (t.assignedTo) bits.push("→ " + name(t.assignedTo));
    if (t.reschedules) bits.push(`moved ${t.reschedules}x`);
    if (t.remindAt) bits.push("⏰ " + t.remindAt);
    return `• ${esc(t.title)}${bits.length ? ` <i>(${esc(bits.join(" · "))})</i>` : ""}`;
  };
  const cap = arr => arr.length > MAX_PER_SECTION ? [...arr.slice(0, MAX_PER_SECTION), `…and ${arr.length - MAX_PER_SECTION} more`] : arr;

  const one = tasks.filter(t => t.repeat !== "daily");
  const open = one.filter(t => !t.done);
  const tooLate = open.filter(t => (t.reschedules || 0) >= 3);
  const late = open.filter(t => (t.reschedules || 0) < 3 && t.due && t.due < today);
  const dueToday = open.filter(t => (t.reschedules || 0) < 3 && t.due === today);
  const routines = tasks.filter(t => t.repeat === "daily" && !isDone(t));
  const yday = addDays(today, -1);
  const doneY = one.filter(t => t.done && t.doneAt && dayOf(t.doneAt) === yday);
  const onY = doneY.filter(onTime).length;
  const routineY = tasks.filter(t => t.repeat === "daily" && (t.doneDays || []).includes(yday)).length;

  const out = [`<b>🛰 COMMAND DECK · ${esc(fmt(today))}</b>`, `Good morning! Here is today's plan.`];
  if (tooLate.length) out.push("", `<b>⚠ TOO LATE — moved 3+ times (${tooLate.length})</b>`, `Complete these ASAP.`, ...cap(tooLate.map(line)));
  if (late.length) out.push("", `<b>🔴 Late (${late.length})</b>`, ...cap(late.map(t => line(t) + ` — due ${esc(fmt(t.due))}`)));
  if (dueToday.length) out.push("", `<b>🟡 Due today (${dueToday.length})</b>`, ...cap(dueToday.map(line)));
  if (routines.length) out.push("", `<b>↻ Daily routines (${routines.length})</b>`, ...cap(routines.map(line)));

  const team = users.filter(u => !u.disabled).map(u => {
    const mine = open.filter(t => t.assignedTo === u.id);
    if (!mine.length) return null;
    const lt = mine.filter(t => t.due && t.due < today).length, tl = mine.filter(t => (t.reschedules || 0) >= 3).length;
    return `• ${esc(u.name)}: ${mine.length} open${lt ? `, ${lt} late` : ""}${tl ? `, ${tl} too late ⚠` : ""}`;
  }).filter(Boolean);
  if (team.length) out.push("", `<b>👥 Team</b>`, ...team);

  /* sales leads */
  const STAGES = ["Generating requirement","Requirement generated","Quotation shared","Waiting for PO","Waiting for fund","Fund received"];
  const won = l => l.stage === STAGES[5] || !!l.lost;
  leads = leads.filter(l => !l.lost);
  const nextFollow = l => {
    if (won(l)) return "";
    const lf = l.lastFollow || "";
    if (l.followMode === "daily") return lf === today ? addDays(today, 1) : today;
    if (l.followMode === "every3") return addDays(lf || dayOf(l.createdAt || Date.now()), 3);
    if (l.followMode === "date") return l.followDate && (!lf || lf < l.followDate) ? l.followDate : "";
    return "";
  };
  const tmrw = addDays(today, 1);
  const leadLine = (l, extra) => `• ${esc(l.name)} <i>(${esc([extra, l.contact, l.phone, l.stage].filter(Boolean).join(" · "))})</i>`;
  const mToday = leads.filter(l => (l.meetingAt || "").slice(0, 10) === today).sort((a, b) => (a.meetingAt < b.meetingAt ? -1 : 1));
  const mTmrw = leads.filter(l => (l.meetingAt || "").slice(0, 10) === tmrw).sort((a, b) => (a.meetingAt < b.meetingAt ? -1 : 1));
  const fuDue = leads.filter(l => { const nf = nextFollow(l); return nf && nf <= today; });
  if (mToday.length) out.push("", `<b>🤝 Meetings today (${mToday.length})</b>`, ...cap(mToday.map(l => leadLine(l, "⏰ " + l.meetingAt.slice(11, 16) + (l.meetingNote ? " · " + l.meetingNote : "")))));
  if (mTmrw.length) out.push("", `<b>📅 Meetings tomorrow (${mTmrw.length})</b>`, ...cap(mTmrw.map(l => leadLine(l, "⏰ " + l.meetingAt.slice(11, 16) + (l.meetingNote ? " · " + l.meetingNote : "")))));
  const stuck = leads.filter(l => !won(l) && (Date.now() - ((l.activity || []).filter(a => a.t === "stage").pop()?.at || l.createdAt || Date.now())) / 864e5 >= 15);
  if (fuDue.length) out.push("", `<b>📞 Lead follow-ups (${fuDue.length})</b>`, ...cap(fuDue.map(l => { const nf = nextFollow(l); return leadLine(l, (l.followReason || "Call back") + (nf < today ? " · overdue since " + fmt(nf) : "")); })));

  if (stuck.length) out.push("", `<b>⏳ Stuck 15+ days in one stage (${stuck.length})</b>`, ...cap(stuck.map(l => leadLine(l, l.assigneeName ? "→ " + l.assigneeName : ""))));
  out.push("", `<b>✅ Yesterday</b>`, `${doneY.length} task${doneY.length === 1 ? "" : "s"} completed (${onY} on time) · ${routineY} routine${routineY === 1 ? "" : "s"} done`);
  if (!tooLate.length && !late.length && !dueToday.length && !routines.length && !mToday.length && !mTmrw.length && !fuDue.length) out.splice(2, 0, "", "All clear — nothing due today. 🎯");
  let text = out.join("\n");
  if (text.length > 4000) text = text.slice(0, 3990) + "\n…";
  return text;
}

async function main() {
  const { FIREBASE_SERVICE_ACCOUNT, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!FIREBASE_SERVICE_ACCOUNT || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("Missing secret. Add FIREBASE_SERVICE_ACCOUNT, TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in GitHub → Settings → Secrets and variables → Actions.");
  }
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();
  const [tSnap, uSnap, lSnap] = await Promise.all([db.collection("adminTasks").get(), db.collection("users").get(), db.collection("leads").get()]);
  const tasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const users = uSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const leads = lSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const text = buildReport(tasks, users, todayIn(), leads);
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) throw new Error("Telegram error: " + (body.description || r.status));
  console.log("Report sent:", tasks.length, "tasks checked.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message || e); process.exit(1); });
}
