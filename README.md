# clearance-central

the central server for [clearance](https://github.com/syrenaaa/clearance), a trust scoring plugin
for scp:sl servers. servers running the plugin share bans and anonymous stats through it.

live at <https://sl-clearance.val.run>: [stats](https://sl-clearance.val.run/stats) ·
[api docs](https://sl-clearance.val.run/docs) · [privacy](https://sl-clearance.val.run/privacy)

not affiliated with northwood studios.

## how it works

- **bans:** servers report their bans. when someone joins, a server can ask how many running bans
  they have elsewhere, but never which servers banned them
- **stats:** servers can share daily counts with no player ids. the network totals are public on the
  [stats page](https://sl-clearance.val.run/stats)
- **facts, not verdicts:** it only says what happened. each server decides what that means for a
  join

## privacy

only bans are stored, never names, ips, chat or play time, and they're deleted after 2 years. see
the [privacy policy](https://sl-clearance.val.run/privacy).

## dev

needs [deno](https://deno.com) 2.

```sh
deno task test
deno task check
```

## deploy

runs on [val town](https://www.val.town):

1. copy the files into a val (`main.ts` as http, `cron.ts` as a daily interval)
2. set `CENTRAL_ADMIN_KEY` in the val's env vars
3. open `/admin`, register a server, and put its key in the plugin config as `CentralKey`

## license

[MPL-2.0](LICENSE)
