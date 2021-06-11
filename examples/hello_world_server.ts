// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";

const helloWorld = await createWorker(
  "./examples/deploy_scripts/hello_world.ts",
  { name: "helloWorld" },
);

(async () => {
  for await (let log of helloWorld.logs) {
    if (log.endsWith("\n")) {
      log = log.slice(0, -1);
    }
    console.log(`[${helloWorld.name}]: ${log}`);
  }
})();

await helloWorld.listen({ port: 8000 });

console.log("Listening on port 8000...");
