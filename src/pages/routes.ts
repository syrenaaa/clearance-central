/** static pages: index, stats, privacy, admin, api docs, the spec, shared css + js */

import type { Route } from "jsr:@std/http@^1.1.4/unstable-route";
import spec from "../../openapi.yaml" with { type: "text" };
import { pattern } from "../http.ts";
import adminJs from "./admin.js" with { type: "text" };
import admin from "./admin.html" with { type: "text" };
import docs from "./docs.html" with { type: "text" };
import home from "./home.html" with { type: "text" };
import privacy from "./privacy.html" with { type: "text" };
import stats from "./stats.html" with { type: "text" };
import css from "./style.css" with { type: "text" };

const page = (path: string, body: string, type: string, extra: HeadersInit = {}): Route => ({
  method: "GET",
  pattern: pattern(path),
  handler: () => new Response(body, { headers: { "content-type": type, ...extra } }),
});

const HTML = "text/html; charset=utf-8";

// the admin page holds the admin key, so: only our own script + css, no inline code, no framing
const LOCKED = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; " +
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
};

export const pageRoutes: Route[] = [
  page("/", home, HTML),
  page("/stats", stats, HTML),
  page("/privacy", privacy, HTML),
  page("/admin", admin, HTML, LOCKED),
  page("/admin.js", adminJs, "text/javascript; charset=utf-8", { "cache-control": "no-store" }),
  page("/docs", docs, HTML),
  page("/style.css", css, "text/css; charset=utf-8"),
  page("/openapi.yaml", spec, "application/yaml"),
];
