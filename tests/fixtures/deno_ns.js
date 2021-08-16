// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

addEventListener("fetch", (event) => {
  const body = {
    build: Object.assign({}, Deno.build),
    customInspect: typeof Deno.customInspect,
    env: Deno.env.toObject(),
    inspect: typeof Deno.inspect,
    listen: typeof Deno.listen,
    noColor: Deno.noColor,
    readFile: typeof Deno.readFile,
    readTextFile: typeof Deno.readTextFile,
    serveHttp: typeof Deno.serveHttp,
    keys: Object.keys(Deno),
  };
  const response = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
  event.respondWith(response);
});
