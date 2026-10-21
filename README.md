# clearance-central

the central server for [clearance](https://github.com/syrenaaa/clearance), a trust scoring plugin
for scp:sl servers. servers running the plugin share **ban reports** and **anonymous daily stats**
through it.

live at <https://sl-clearance.val.run>: [stats](https://sl-clearance.val.run/stats),
[api docs](https://sl-clearance.val.run/docs), [privacy](https://sl-clearance.val.run/privacy).

not affiliated with northwood studios.

## how it works

**facts, not verdicts.** the central server only says what happened ("2 running bans from 2 servers,
the last one 40 days ago"). each game server turns that into points with its own config. it never
returns a score or an allow / deny.

- **bans:** when staff ban someone (for a day or more, by default), the plugin reports it. when a
  player joins, the plugin asks how many running bans they have elsewhere. the answer never says
  which servers banned them. pardons and expired bans don't count
- **stats:** servers that opt in upload one day of counts at a time: how checks ended, scores per
  bucket, bans per join score. no user ids. days with < 20 checks aren't stored, and only days with
  at least 5 servers get summed, so nobody can subtract their own upload and read off someone
  else's. the sums are public on the [stats page](https://sl-clearance.val.run/stats)
- **servers:** every game server gets its own api key (stored hashed). revoking a server hides all
  its reports

lookups happen in pre-auth while the player waits, so `GET /v1/players/{userId}` is one query and
the plugin fails open if it's slow or down.

## api

[`openapi.yaml`](openapi.yaml) is the source of truth (change it first, then the code). rendered at
[`/docs`](https://sl-clearance.val.run/docs).

| route                                 | auth       | what                            |
| ------------------------------------- | ---------- | ------------------------------- |
| `POST /v1/servers`                    | admin      | register / re-key a server      |
| `POST /v1/servers/claims`             | none       | start an ownership claim        |
| `POST /v1/servers/claims/{id}/verify` | none       | finish a claim, get an api key  |
| `DELETE /v1/servers/{serverId}`       | admin      | revoke a server                 |
| `PUT /v1/stats/{day}`                 | server key | upload one day of counts        |
| `GET /v1/stats/network?from=&to=`     | none       | network sums + ban rate / score |
| `POST /v1/reports`                    | server key | report a ban or a pardon        |
| `GET /v1/players/{userId}`            | server key | network facts about a player    |

claims need the verified server list, and there's no way to read that from val town yet, so verify
answers 503 for now. servers are registered by the admin until that's solved.

## privacy

ban reports hold the account id, when, expiry, severity and category. never names, ips, chat, play
time, steam data or scores. there's deliberately no "first seen" / join history: that would be
tracking, not server security. bans and stats are deleted after 2 years. full policy at
[`/privacy`](https://sl-clearance.val.run/privacy).

## layout

```
main.ts            http val entry
cron.ts            interval val entry, daily retention purge
openapi.yaml       the api contract
src/
  app.ts           wires deps (sql, clock, admin key, server list) into the routes
  auth.ts          server key + admin key wrappers
  routes/          one module per api area, each (ctx) => Route[]
  db/              *.ts + *.sql pairs. queries are `-- name: x` sections with :named params
  decode/          input validation, Result-style
  pages/           html + css for /, /stats, /privacy, /docs
  facts.ts         rows -> responses
  limits.ts        policy numbers (retention, min checks, min servers, ...)
test/              runs the whole app in-process on an in-memory sqlite
```

web standard apis only, no `node:`. routing is
[`@std/http/unstable-route`](https://jsr.io/@std/http/doc/unstable-route), storage is val town's
`std/sqlite`. `.sql` and `.html` files are loaded with text imports (`with { type: "text" }`).

## dev

needs [deno](https://deno.com) 2.

```sh
deno task test    # whole app against libsql-wasm in memory
deno task check   # fmt + lint + typecheck
```

## deploy

it runs on [val town](https://www.val.town):

1. make a val and copy in `main.ts` (http), `cron.ts` (interval, daily), `openapi.yaml` and `src/`
2. set `CENTRAL_ADMIN_KEY` (32+ random chars) in the val's env vars
3. open the val once: the schema and any pending `src/db/migrations.sql` steps apply on the first
   request
4. register a server and put the key in the plugin config as `CentralKey`:

```sh
curl -X POST https://<your-val>/v1/servers \
  -H "authorization: Bearer $CENTRAL_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"address":"your.server.ip","port":7777}'
```

the key is only shown once.

## license

[MPL-2.0](LICENSE)
