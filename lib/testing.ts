// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

/** Return a request init that mocks what a Chromium request would look like
 * from a client.
 *
 * @param referrer Optionally set the referrer header in the request init
 */
export function mockChromeRequest(
  referrer?: string,
): RequestInit {
  const headers = [[
    "accept",
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  ], [
    "accept-encoding",
    "gzip, deflate, br",
  ], [
    "accept-language",
    "en-GB,en-US;q=0.9,en;q=0.8",
  ], [
    "sec-fetch-dest",
    "document",
  ], [
    "sec-fetch-mode",
    "navigate",
  ], [
    "sec-fetch-site",
    "cross-site",
  ], [
    "sec-fetch-user",
    "?1",
  ], [
    "sec-gpc",
    "1",
  ], [
    "upgrade-insecure-requests",
    "1",
  ], [
    "user-agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
  ]];
  if (referrer != null) {
    headers.push(["referrer", referrer]);
  }
  return {
    headers,
  };
}
