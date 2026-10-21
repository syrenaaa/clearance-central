/** static pages: index, stats, privacy, api docs, the spec, shared css */

import type { Route } from "jsr:@std/http@^1.1.4/unstable-route";
import spec from "../../openapi.yaml" with { type: "text" };
import { pattern } from "../http.ts";
import docs from "./docs.html" with { type: "text" };
import home from "./home.html" with { type: "text" };
import privacy from "./privacy.html" with { type: "text" };
import stats from "./stats.html" with { type: "text" };
import css from "./style.css" with { type: "text" };

const page = (path: string, body: string, type: string): Route => ({
  method: "GET",
  pattern: pattern(path),
  handler: () => new Response(body, { headers: { "content-type": type } }),
});

const HTML = "text/html; charset=utf-8";

export const pageRoutes: Route[] = [
  page("/", home, HTML),
  page("/stats", stats, HTML),
  page("/privacy", privacy, HTML),
  page("/docs", docs, HTML),
  page("/style.css", css, "text/css; charset=utf-8"),
  page("/openapi.yaml", spec, "application/yaml"),
];
