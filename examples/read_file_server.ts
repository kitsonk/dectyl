// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";

const readFile = await createWorker(
  "./examples/deploy_scripts/read_file.ts",
  { name: "readFile" },
);

(async () => {
  for await (const log of readFile.logs) {
    console.log(`[${readFile.name}]: ${log}`);
  }
})();

await readFile.listen({ port: 8000 });

console.log("Listening on: http://localhost:8000/");
