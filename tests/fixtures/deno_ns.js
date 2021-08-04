// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

addEventListener("fetch", (event) => {
  const body = {
    env: Deno.env.toObject(),
    noColor: Deno.noColor,
    build: Object.assign({}, Deno.build),
    customInspect: typeof Deno.customInspect,
    inspect: typeof Deno.inspect,
    keys: Object.keys(Deno),
    readFile: typeof Deno.readFile,
    readTextFile: typeof Deno.readTextFile,
  };
  const response = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
  event.respondWith(response);
});
