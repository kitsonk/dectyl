// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";

const helloWorld = await createWorker(
  "./examples/deploy_scripts/hello_world.ts",
  { name: "helloWorld" },
);

(async () => {
  for await (const log of helloWorld.logs) {
    console.log(`[${helloWorld.name}]: ${log}`);
  }
})();

await helloWorld.listen({ port: 8000 });

console.log("Listening on port 8000...");
