// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

addEventListener("fetch", (event) => {
  const body = { headers: [...event.request.headers] };
  const response = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
  event.respondWith(response);
});
