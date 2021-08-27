// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { check, createWorker, testing } from "../mod.ts";
import { assertEquals } from "https://deno.land/std@0.106.0/testing/asserts.ts";
import {
  contentType,
  lookup,
} from "https://deno.land/x/media_types@v2.9.0/mod.ts";

Deno.test({
  name: "root page static_assets",
  async fn() {
    const staticAssets = await createWorker(
      "./examples/deploy_scripts/static_assets.ts",
    );
    await staticAssets.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(
        await response.text(),
        `<html>\n      <head>\n        <link rel="stylesheet" href="style.css" />\n      </head>\n      <body>\n        <h1>Example</h1>\n      </body>\n    </html>`,
      );
      assertEquals([...response.headers], [[
        "content-type",
        "text/html; charset=utf-8",
      ]]);
    });
  },
});

Deno.test({
  name: "root page static_assets no bundle",
  async fn() {
    const staticAssets = await createWorker(
      "./examples/deploy_scripts/static_assets.ts",
      {
        bundle: false,
      },
    );
    await staticAssets.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(
        await response.text(),
        `<html>\n      <head>\n        <link rel="stylesheet" href="style.css" />\n      </head>\n      <body>\n        <h1>Example</h1>\n      </body>\n    </html>`,
      );
      assertEquals([...response.headers], [[
        "content-type",
        "text/html; charset=utf-8",
      ]]);
    });
  },
});

Deno.test({
  name: "static asset static_assets",
  async fn() {
    const staticAssets = await createWorker(
      "./examples/deploy_scripts/static_assets.ts",
      {
        async fetchHandler(evt) {
          const url = new URL(evt.request.url);
          if (url.protocol === "file:") {
            const ct = contentType(lookup(evt.request.url) ?? "") ??
              "text/plain";
            const body = await Deno.readFile(url);
            const response = new Response(body, {
              headers: {
                "content-type": ct,
              },
            });
            evt.respondWith(response);
          }
        },
      },
    );

    await staticAssets.run(async function () {
      const [response] = await this.fetch("/style.css");
      assertEquals(
        await response.text(),
        "body {\n  background-color: wheat;\n}",
      );
      assertEquals(
        [...response.headers],
        [["content-type", "text/css; charset=utf-8"]],
      );
    });
  },
});

Deno.test({
  name: "static asset type checking",
  async fn() {
    testing.assertDiagnostics(
      await check("./examples/deploy_scripts/static_assets.ts"),
    );
  },
});
