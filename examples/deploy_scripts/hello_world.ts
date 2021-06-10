/// <reference path="../../types/deploy.fetchevent.d.ts" />

addEventListener("fetch", (event) => {
  console.log("fetch");
  console.log(event.request.url);
  const response = new Response("Hello World!", {
    headers: { "content-type": "text/plain" },
  });
  event.respondWith(response);
});
