/** api docs: the spec + a scalar ui for it */

import type { Route } from "jsr:@std/http@^1.1.4/unstable-route";

const SCALAR =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.0/dist/browser/standalone.js";

// servers points scalar's "try it" at this deployment, not the spec's example url
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>clearance-central API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR}"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "/openapi.yaml",
        servers: [{ url: location.origin }],
      });
    </script>
  </body>
</html>
`;

/** `GET /` (ui) and `GET /openapi.yaml`. `spec` is read once, then cached */
export const docsRoutes = (spec: () => Promise<string>): Route[] => {
  let text: Promise<string> | undefined;
  const load = () =>
    text ??= spec().catch((e) => {
      text = undefined;
      throw e;
    });
  return [
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/" }),
      handler: () =>
        new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    },
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/openapi.yaml" }),
      handler: async () =>
        new Response(await load(), { headers: { "content-type": "application/yaml" } }),
    },
  ];
};
