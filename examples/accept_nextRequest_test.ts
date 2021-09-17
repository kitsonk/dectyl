// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { check, createWorker, testing } from "../mod.ts";
import { assertEquals } from "https://deno.land/std@0.107.0/testing/asserts.ts";

Deno.test({
  name: "basic accept-nextRequest test",
  async fn() {
    const acceptNextRequest = await createWorker(
      "./examples/deploy_scripts/accept_nextRequest.ts",
    );
    await acceptNextRequest.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(await response.text(), "Hello World!");
      assertEquals([...response.headers], [["content-type", "text/plain"]]);
    });
  },
});

Deno.test({
  name: "accept-nextRequest logging test",
  async fn() {
    const acceptNextRequest = await createWorker(
      "./examples/deploy_scripts/accept_nextRequest.ts",
    );

    const logs: string[] = [];
    (async () => {
      for await (const log of acceptNextRequest.logs) {
        logs.push(log);
      }
    })();

    await acceptNextRequest.run(async function () {
      await this.fetch("/");
      assertEquals(logs, ["request", "https://localhost/"]);
    });
  },
});

Deno.test({
  name: "accept-nextRequest no bundle",
  async fn() {
    const acceptNextRequest = await createWorker(
      "./examples/deploy_scripts/accept_nextRequest.ts",
      { bundle: false },
    );

    const logs: string[] = [];
    (async () => {
      for await (const log of acceptNextRequest.logs) {
        logs.push(log);
      }
    })();

    await acceptNextRequest.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(await response.text(), "Hello World!");
      assertEquals([...response.headers], [["content-type", "text/plain"]]);
    });
  },
});

Deno.test({
  name: "accept-nextRequest type checking",
  async fn() {
    testing.assertDiagnostics(
      await check("./examples/deploy_scripts/accept_nextRequest.ts"),
    );
  },
});
