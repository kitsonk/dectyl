async function serve(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);
  while (true) {
    const requestEvent = await httpConn.nextRequest();
    if (!requestEvent) {
      return;
    }
    const { request, respondWith } = requestEvent;
    console.log("request");
    console.log(request.url);
    const response = new Response("Hello World!", {
      headers: { "content-type": "text/plain" },
    });
    await respondWith(Promise.resolve(response));
  }
}

async function accept(listener: Deno.Listener) {
  while (true) {
    try {
      const conn = await listener.accept();
      serve(conn);
    } catch {
      return;
    }
  }
}

const listener = Deno.listen({ port: 8000 });

accept(listener);

export {};
