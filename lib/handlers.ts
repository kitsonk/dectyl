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
    let response: Response;
    try {
      const stat = await Deno.stat(url);
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
          status: 403,
          statusText: "Forbidden",
        });
      }
    } catch {
      response = new Response(null, {
        status: 404,
        statusText: "Not Found",
      });
    }
    evt.respondWith(response);
  }
}

/** A descriptor for a fetch handler matchers. */
interface Matcher {
  /** A string or a regular expression, that is used to match against the URL
   * of the request.  The first match that is true, the `response` will be used
   * to respond to the request.
   *
   * Strings are matched based on `url.includes()`.
   */
  match: string | RegExp;
  /** If matched, used to provide the response, which either either a
   * `Response`, a tuple of arguments which will be passed to `new Response()`
   * or a function which will be called passing the `Request` with the function
   * either returning or resolving with the `Response` or `undefined`. If the
   * response is `undefined` the matcher will not respond to the request. */
  response:
    | Response
    | [BodyInit | null | undefined, ResponseInit | undefined]
    | ((
      request: Request,
    ) => Promise<Response | undefined> | Response | undefined);
}

export function createMatcherHandler(
  ...matchers: Matcher[]
): (evt: RequestEvent) => Promise<void> {
  return async function matcher(evt) {
    const matcher = matchers.find(({ match }) =>
      typeof match === "string"
        ? evt.request.url.includes(match)
        : evt.request.url.match(match)
    );
    if (matcher) {
      const { response } = matcher;
      if (Array.isArray(response)) {
        evt.respondWith(new Response(...response));
      } else if (typeof response === "function") {
        const maybeResponse = await response(evt.request);
        if (maybeResponse) {
          evt.respondWith(maybeResponse);
        }
      } else {
        evt.respondWith(response);
      }
    }
  };
}
