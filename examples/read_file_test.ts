// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { check, createWorker, testing } from "../mod.ts";
import { assertEquals } from "https://deno.land/std@0.106.0/testing/asserts.ts";

Deno.test({
  name: "root page read_file",
  async fn() {
    const readFile = await createWorker(
      "./examples/deploy_scripts/read_file.ts",
    );
    await readFile.run(async function () {
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
  name: "root page read_file no bundle",
  async fn() {
    const readFile = await createWorker(
      "./examples/deploy_scripts/read_file.ts",
      {
        bundle: false,
      },
    );
    await readFile.run(async function () {
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
  name: "static asset read_file",
  async fn() {
    const readFile = await createWorker(
      "./examples/deploy_scripts/read_file.ts",
    );

    await readFile.run(async function () {
      const [response] = await this.fetch("/style.css");
      assertEquals(
        await response.text(),
        "body {\n  background-color: wheat;\n}",
      );
      assertEquals(
        [...response.headers],
        [["content-type", "text/css"]],
      );
    });
  },
});

Deno.test({
  name: "static asset type checking",
  async fn() {
    testing.assertDiagnostics(
      await check("./examples/deploy_scripts/read_file.ts"),
    );
  },
});
