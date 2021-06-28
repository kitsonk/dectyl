import {
  contentType,
  lookup,
} from "https://deno.land/x/media_types@v2.9.0/mod.ts";

import type { RequestEvent } from "../types.d.ts";

/**
 * A fetch handler that returns local files that are requested by the worker.
 *
 * This is useful when the worker is attempting to access static assets from
 * its repo using `import.meta.url` as the base for a fetch request.
 */
export async function fileFetchHandler(evt: RequestEvent) {
  const url = new URL(evt.request.url);
  if (url.protocol === "file:") {
    const stat = await Deno.stat(url);
    let response: Response;
    if (stat.isFile) {
      const ct = contentType(lookup(evt.request.url) ?? "") ?? "text/plain";
      const body = await Deno.readFile(url);
      response = new Response(body, {
        headers: {
          "content-type": ct,
        },
      });
    } else {
      response = new Response(null, {
        status: 404,
        statusText: "Not Found",
      });
    }
    evt.respondWith(response);
  }
}
