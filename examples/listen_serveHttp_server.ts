// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";

const listenServeHttp = await createWorker(
  "./examples/deploy_scripts/listen_serverHttp.ts",
  { name: "listenServeHttp" },
);

(async () => {
  for await (const log of listenServeHttp.logs) {
    console.log(`[${listenServeHttp.name}]: ${log}`);
  }
})();

await listenServeHttp.listen({ port: 8000 });

console.log("Listening on port 8000...");
