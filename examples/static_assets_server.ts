// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";
import {
  contentType,
  lookup,
} from "https://deno.land/x/media_types@v2.9.0/mod.ts";

const staticAssets = await createWorker(
  "./examples/deploy_scripts/static_assets.ts",
  {
    name: "staticAssets",
    async fetchHandler(evt) {
      const url = new URL(evt.request.url);
      if (url.protocol === "file:") {
        const ct = contentType(lookup(evt.request.url) ?? "") ??
          "text/plain";
        const body = await Deno.readFile(url);
        const response = new Response(body, {
          headers: {
            "content-type": ct,
          },
        });
        evt.respondWith(response);
      }
    },
  },
);

(async () => {
  for await (const log of staticAssets.logs) {
    console.log(`[${staticAssets.name}]: ${log}`);
  }
})();

await staticAssets.listen({ port: 8000 });

console.log("Listening on: http://localhost:8000/");
