async function serve(conn: Deno.Conn) {
  for await (const { request, respondWith } of Deno.serveHttp(conn)) {
    console.log("request");
    console.log(request.url);
    const response = new Response("Hello World!", {
      headers: { "content-type": "text/plain" },
    });
    await respondWith(Promise.resolve(response));
  }
}

async function accept(listener: Deno.Listener) {
  for await (const conn of listener) {
    serve(conn);
  }
}

const listener = Deno.listen({ port: 8000 });

accept(listener);

export {};
