/** static pages: index, api docs, the spec */

import type { Route } from "jsr:@std/http@^1.1.4/unstable-route";
import spec from "../../openapi.yaml" with { type: "text" };
import { pattern } from "../http.ts";
import docs from "./docs.html" with { type: "text" };
import home from "./home.html" with { type: "text" };

const page = (path: string, body: string, type: string): Route => ({
  method: "GET",
  pattern: pattern(path),
  handler: () => new Response(body, { headers: { "content-type": type } }),
});

const HTML = "text/html; charset=utf-8";

export const pageRoutes: Route[] = [
  page("/", home, HTML),
  page("/docs", docs, HTML),
  page("/openapi.yaml", spec, "application/yaml"),
];
