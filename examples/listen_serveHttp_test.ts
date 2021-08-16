// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { check, createWorker, testing } from "../mod.ts";
import { assertEquals } from "https://deno.land/std@0.104.0/testing/asserts.ts";

Deno.test({
  name: "basic listen-serve test",
  async fn() {
    const listenServe = await createWorker(
      "./examples/deploy_scripts/listen_serverHttp.ts",
    );
    await listenServe.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(await response.text(), "Hello World!");
      assertEquals([...response.headers], [["content-type", "text/plain"]]);
    });
  },
});

Deno.test({
  name: "listen-serve logging test",
  async fn() {
    const listenServe = await createWorker(
      "./examples/deploy_scripts/listen_serverHttp.ts",
    );

    const logs: string[] = [];
    (async () => {
      for await (const log of listenServe.logs) {
        logs.push(log);
      }
    })();

    await listenServe.run(async function () {
      await this.fetch("/");
      assertEquals(logs, ["request", "https://localhost/"]);
    });
  },
});

Deno.test({
  name: "listen-serve no bundle",
  async fn() {
    const listenServe = await createWorker(
      "./examples/deploy_scripts/listen_serverHttp.ts",
      { bundle: false },
    );

    const logs: string[] = [];
    (async () => {
      for await (const log of listenServe.logs) {
        logs.push(log);
      }
    })();

    await listenServe.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(await response.text(), "Hello World!");
      assertEquals([...response.headers], [["content-type", "text/plain"]]);
    });
  },
});

Deno.test({
  name: "listen-serve type checking",
  async fn() {
    testing.assertDiagnostics(
      await check("./examples/deploy_scripts/listen_serverHttp.ts"),
    );
  },
});
