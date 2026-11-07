// Local stand-in for the parts of Supabase the app uses (PostgREST + GoTrue), over a real Postgres
// running the real migration and RLS policies. Requests run as the `authenticated` role with
// request.jwt.claim.sub set, exactly as Supabase does, so privacy rules are exercised for real.
// Test-only: no signatures, no email. Usage: node e2e/server.mjs  (env PGHOST/PGPORT/PGUSER/PGDATABASE, PORT)
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

pg.types.setTypeParser(1700, (v) => (v == null ? null : Number(v))); // numeric → number, like PostgREST
pg.types.setTypeParser(1082, (v) => v); // date stays YYYY-MM-DD
const pool = new pg.Pool();
const PORT = Number(process.env.PORT ?? 54321);

const TABLES = {
  profiles: ["id"], people: ["id"], families: ["id"], family_members: ["family_id", "person_id"],
  family_invites: ["code"], person_claims: ["code"], price_series: ["id"], price_points: ["series_id", "d"],
  holdings: ["id"], holding_owners: ["holding_id", "person_id"], holding_snapshots: ["holding_id", "d"],
  goals: ["id"], goal_links: ["goal_id", "holding_id"], signals: ["id"],
};
const RPCS = new Set(["join_family", "claim_person", "record_snapshot", "record_price"]);
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 });
  return `"${s}"`;
};
const tokens = new Map(); // access token → user id

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function issue(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: user.id, role: "authenticated", exp, email: user.email })}.x`;
  const refresh_token = crypto.randomUUID();
  tokens.set(access_token, user.id);
  tokens.set("r:" + refresh_token, user.id);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token, user: gotrueUser(user) };
}
function gotrueUser(u) {
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email" }, user_metadata: u.raw_user_meta_data ?? {}, created_at: new Date().toISOString() };
}

async function asUser(uid, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (uid) {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    } else await c.query("set local role anon");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally { c.release(); }
}

function parseFilters(params) {
  const where = [];
  const vals = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns"].includes(k)) continue;
    const m = /^(eq|neq|in|is|gt|gte|lt|lte)\.(.*)$/s.exec(v);
    if (!m) throw Object.assign(new Error(`unsupported filter ${k}=${v}`), { status: 400 });
    const col = ident(k);
    if (m[1] === "in") {
      const list = m[2].replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      vals.push(list);
      where.push(`${col}::text = any($${vals.length}::text[])`);
    } else if (m[1] === "is") where.push(`${col} is ${m[2] === "null" ? "null" : m[2] === "true" ? "true" : "false"}`);
    else {
      vals.push(m[2]);
      const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[m[1]];
      where.push(`${col}::text ${op} $${vals.length}`);
    }
  }
  return { where: where.length ? " where " + where.join(" and ") : "", vals };
}
const selectList = (s) => (!s || s === "*" ? "*" : s.split(",").map((x) => ident(x.trim())).join(", "));

async function rest(req, url, uid, body) {
  const parts = url.pathname.replace(/^\/rest\/v1\//, "").split("/");
  const prefer = req.headers["prefer"] ?? "";
  const single = (req.headers["accept"] ?? "").includes("vnd.pgrst.object");
  if (parts[0] === "rpc") {
    const fn = parts[1];
    if (!RPCS.has(fn)) throw Object.assign(new Error("unknown function"), { status: 404 });
    const args = Object.entries(body ?? {});
    const sql = `select public.${ident(fn)}(${args.map(([k], i) => `${ident(k)} => $${i + 1}`).join(", ")}) as r`;
    const r = await asUser(uid, (c) => c.query(sql, args.map(([, v]) => v)));
    return { status: 200, json: r.rows[0]?.r ?? null };
  }
  const table = parts[0];
  if (!TABLES[table]) throw Object.assign(new Error(`unknown table ${table}`), { status: 404 });
  const t = `public.${ident(table)}`;
  const p = url.searchParams;
  const ret = prefer.includes("return=representation");
  const cols = selectList(p.get("select"));
  if (req.method === "GET") {
    const { where, vals } = parseFilters(p);
    let sql = `select ${cols} from ${t}${where}`;
    const ord = p.get("order");
    if (ord) sql += " order by " + ord.split(",").map((o) => { const [c, d] = o.split("."); return `${ident(c)} ${d === "desc" ? "desc" : "asc"}`; }).join(", ");
    if (p.get("limit")) sql += ` limit ${Number(p.get("limit"))}`;
    const r = await asUser(uid, (c) => c.query(sql, vals));
    return { status: 200, json: single ? r.rows[0] ?? null : r.rows };
  }
  if (req.method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    if (!rows.length) return { status: 201, json: [] };
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const vals = [];
    const tuples = rows.map((r) => "(" + keys.map((k) => { vals.push(r[k] === undefined ? null : typeof r[k] === "object" && r[k] !== null ? JSON.stringify(r[k]) : r[k]); return `$${vals.length}`; }).join(", ") + ")");
    let sql = `insert into ${t} (${keys.map(ident).join(", ")}) values ${tuples.join(", ")}`;
    if (prefer.includes("resolution=merge-duplicates")) {
      const pk = (p.get("on_conflict")?.split(",") ?? TABLES[table]).map(ident);
      const upd = keys.filter((k) => !TABLES[table].includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`);
      sql += ` on conflict (${pk.join(", ")}) ` + (upd.length ? `do update set ${upd.join(", ")}` : "do nothing");
    }
    if (ret) sql += ` returning ${cols}`;
    const r = await asUser(uid, (c) => c.query(sql, vals));
    return { status: 201, json: ret ? (single ? r.rows[0] ?? null : r.rows) : null };
  }
  if (req.method === "PATCH") {
    const { where, vals } = parseFilters(p);
    const keys = Object.keys(body ?? {});
    const set = keys.map((k, i) => `${ident(k)} = $${vals.length + i + 1}`).join(", ");
    const v2 = keys.map((k) => (typeof body[k] === "object" && body[k] !== null ? JSON.stringify(body[k]) : body[k]));
    const r = await asUser(uid, (c) => c.query(`update ${t} set ${set}${where}${ret ? ` returning ${cols}` : ""}`, [...vals, ...v2]));
    return { status: ret ? 200 : 204, json: ret ? r.rows : null };
  }
  if (req.method === "DELETE") {
    const { where, vals } = parseFilters(p);
    await asUser(uid, (c) => c.query(`delete from ${t}${where}`, vals));
    return { status: 204, json: null };
  }
  throw Object.assign(new Error("method not allowed"), { status: 405 });
}

async function auth(req, url, body) {
  const path = url.pathname.replace(/^\/auth\/v1\//, "");
  if (path === "signup") {
    const id = crypto.randomUUID();
    const exists = await pool.query("select 1 from auth.users where email = $1", [body.email]);
    if (exists.rowCount) return { status: 422, json: { code: 422, error_code: "user_already_exists", msg: "User already registered" } };
    await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, body.email, body.data ?? {}]);
    await pool.query("create table if not exists auth.passwords (id uuid primary key, pw text)");
    await pool.query("insert into auth.passwords values ($1, $2)", [id, body.password]);
    return { status: 200, json: issue({ id, email: body.email, raw_user_meta_data: body.data }) };
  }
  if (path === "token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const r = await pool.query("select u.id, u.email, u.raw_user_meta_data from auth.users u join auth.passwords p on p.id = u.id where u.email = $1 and p.pw = $2", [body.email, body.password]);
      if (!r.rowCount) return { status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: 400 } };
      return { status: 200, json: issue(r.rows[0]) };
    }
    if (grant === "refresh_token") {
      const uid = tokens.get("r:" + body.refresh_token);
      if (!uid) return { status: 400, json: { error: "invalid_grant", msg: "Invalid Refresh Token" } };
      const r = await pool.query("select id, email, raw_user_meta_data from auth.users where id = $1", [uid]);
      return { status: 200, json: issue(r.rows[0]) };
    }
  }
  if (path === "user") {
    const uid = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!uid) return { status: 401, json: { msg: "invalid JWT" } };
    const r = await pool.query("select id, email, raw_user_meta_data from auth.users where id = $1", [uid]);
    return { status: 200, json: gotrueUser(r.rows[0]) };
  }
  if (path === "logout") return { status: 204, json: null };
  return { status: 404, json: { msg: "not supported in test server" } };
}

http.createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, "http://x");
  let raw = "";
  for await (const ch of req) raw += ch;
  const body = raw ? JSON.parse(raw) : null;
  try {
    let out;
    if (url.pathname.startsWith("/auth/v1/")) out = await auth(req, url, body);
    else if (url.pathname.startsWith("/rest/v1/")) {
      const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      out = await rest(req, url, tokens.get(tok) ?? null, body);
    } else out = { status: 404, json: { msg: "not found" } };
    res.writeHead(out.status, { ...cors, "content-type": "application/json" });
    res.end(out.json == null ? (out.status === 204 ? "" : "null") : JSON.stringify(out.json));
  } catch (e) {
    const status = e.status ?? (e.code === "42501" ? 403 : 400);
    if (process.env.E2E_LOG) console.error(req.method, req.url, e.message);
    res.writeHead(status, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ code: e.code ?? String(status), message: e.message, details: e.detail ?? null, hint: null }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`kosh test api on :${PORT}`));
