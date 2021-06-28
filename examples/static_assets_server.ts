// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker, handlers } from "../mod.ts";

const staticAssets = await createWorker(
  "./examples/deploy_scripts/static_assets.ts",
  {
    name: "staticAssets",
    fetchHandler: handlers.fileFetchHandler,
  },
);

(async () => {
  for await (const log of staticAssets.logs) {
    console.log(`[${staticAssets.name}]: ${log}`);
  }
})();

await staticAssets.listen({ port: 8000 });

console.log("Listening on: http://localhost:8000/");
