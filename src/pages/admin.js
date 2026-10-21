// admin page: a client for the admin api. the key lives in sessionStorage only,
// and everything is rendered with textContent, never html strings

const $ = (id) => document.getElementById(id);
const KEY = "cc-admin-key";

const store = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      v === null ? sessionStorage.removeItem(KEY) : sessionStorage.setItem(KEY, v);
    } catch { /* private mode etc, key just isn't remembered */ }
  },
};

let key = store.get();

/** { status, body } for an admin api call. body is parsed json or null */
const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

const show = (el, on) => (el.hidden = !on);
const say = (el, text) => {
  el.textContent = text;
  show(el, text !== "");
};
const errText = (r) => r.body?.message ?? r.body?.error ?? `http ${r.status}`;

const date = (t) => t === null ? "-" : new Date(t * 1000).toISOString().slice(0, 10);
const short = (id) => id.slice(-8);

/** element with text, or with children */
const el = (tag, ...kids) => {
  const e = document.createElement(tag);
  for (const k of kids) e.append(k instanceof Node ? k : String(k));
  return e;
};
const btn = (label, onclick, cls) => {
  const b = el("button", label);
  b.type = "button";
  if (cls) b.className = cls;
  b.onclick = onclick;
  return b;
};
const row = (...cells) => el("tr", ...cells.map((c) => el("td", c)));

// session

const lock = () => {
  key = null;
  store.set(null);
  show($("app"), false);
  show($("unlock"), true);
  $("key").value = "";
};

/** 401 anywhere means the key is wrong or rotated */
const guard = (r) => {
  if (r.status !== 401) return true;
  lock();
  say($("unlock-err"), "that key didn't work.");
  return false;
};

const fail = (r) => say($("err"), `something went wrong: ${errText(r)}`);

// servers

const loadServers = async () => {
  const r = await api("GET", "/v1/servers");
  if (!guard(r)) return false;
  if (r.status !== 200) return fail(r), false;
  const tb = $("servers");
  tb.replaceChildren();
  for (const s of r.body.servers) {
    const id = el("code", short(s.serverId));
    id.title = s.serverId;
    const action = s.revokedAt === null
      ? btn("revoke", () => revoke(s), "bad")
      : el("span", `revoked ${date(s.revokedAt)}`);
    const tr = row(
      id,
      `${s.address}:${s.port}`,
      date(s.createdAt),
      s.bans,
      s.lastStatsDay ?? "-",
      action,
    );
    if (s.revokedAt !== null) tr.className = "mute";
    tb.append(tr);
  }
  if (r.body.servers.length === 0) tb.append(row("no servers yet", "", "", "", "", ""));
  return true;
};

const revoke = async (s) => {
  if (
    !confirm(`revoke ${s.address}:${s.port}? its key stops working and its reports are hidden.`)
  ) return;
  const r = await api("DELETE", `/v1/servers/${encodeURIComponent(s.serverId)}`);
  if (!guard(r)) return;
  if (r.status !== 204) return fail(r);
  await loadServers();
};

$("register").onsubmit = async (e) => {
  e.preventDefault();
  const address = $("addr").value.trim();
  const r = await api("POST", "/v1/servers", { address, port: Number($("port").value) });
  if (!guard(r)) return;
  if (r.status !== 201) return fail(r);
  $("newkey-for").textContent = `${address}:${$("port").value}`;
  $("newkey-val").textContent = r.body.apiKey;
  show($("newkey"), true);
  $("addr").value = "";
  await loadServers();
};

$("copy").onclick = () => navigator.clipboard?.writeText($("newkey-val").textContent);
$("hide").onclick = () => {
  $("newkey-val").textContent = "";
  show($("newkey"), false);
};

// players

let current = null;

const state = (x) => {
  if (x.pardonedAt !== null) return `pardoned ${date(x.pardonedAt)}`;
  if (x.expiresAt !== null && x.expiresAt * 1000 <= Date.now()) return "expired";
  return "running";
};

const loadPlayer = async (uid) => {
  const r = await api("GET", `/v1/players/${encodeURIComponent(uid)}/reports`);
  if (!guard(r)) return;
  if (r.status === 400) return say($("player-status"), errText(r)), show($("player"), false);
  if (r.status !== 200) return fail(r);
  current = r.body.userId;
  const reports = r.body.reports;
  say(
    $("player-status"),
    `${current}: ${reports.length} ban report${reports.length === 1 ? "" : "s"}`,
  );
  const tb = $("reports");
  tb.replaceChildren();
  for (const x of reports) {
    const srv = el("code", short(x.serverId));
    srv.title = `${x.serverId}, their ref ${x.clientRef}`;
    tb.append(row(
      date(x.at),
      x.expiresAt === null ? "permanent" : date(x.expiresAt),
      x.severity,
      x.category,
      srv,
      state(x),
      btn("delete", () => delOne(x), "bad"),
    ));
  }
  show($("player"), reports.length > 0);
};

const delOne = async (x) => {
  if (!confirm(`delete the ${date(x.at)} ${x.category} ban for ${current}?`)) return;
  const r = await api("DELETE", `/v1/reports/${encodeURIComponent(x.reportId)}`);
  if (!guard(r)) return;
  if (r.status !== 204 && r.status !== 404) return fail(r);
  await loadPlayer(current);
};

$("lookup").onsubmit = (e) => {
  e.preventDefault();
  loadPlayer($("uid").value);
};

$("erase").onclick = async () => {
  const typed = prompt(`this erases every ban report for ${current}. type the id to confirm:`);
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== current) {
    return alert("that didn't match, nothing was erased.");
  }
  const r = await api("DELETE", `/v1/players/${encodeURIComponent(current)}/reports`);
  if (!guard(r)) return;
  if (r.status !== 200) return fail(r);
  alert(`erased ${r.body.deleted} ban report(s).`);
  await loadPlayer(current);
  await loadServers();
};

// boot

const open = async () => {
  say($("unlock-err"), "");
  if (!(await loadServers())) return;
  show($("unlock"), false);
  show($("app"), true);
};

$("unlock").onsubmit = (e) => {
  e.preventDefault();
  key = $("key").value.trim();
  store.set(key);
  open();
};

$("lock").onclick = (e) => {
  e.preventDefault();
  lock();
};

if (key) open();
