// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";
import { assertEquals } from "https://deno.land/std@0.97.0/testing/asserts.ts";

Deno.test({
  name: "basic hello-world test",
  async fn() {
    const helloWorld = await createWorker(
      "./examples/deploy_scripts/hello_world.ts",
    );
    await helloWorld.run(async function () {
      const [response] = await this.fetch("/");
      assertEquals(await response.text(), "Hello World!");
      assertEquals([...response.headers], [["content-type", "text/plain"]]);
    });
  },
});

Deno.test({
  name: "hello-world logging test",
  async fn() {
    const helloWorld = await createWorker(
      "./examples/deploy_scripts/hello_world.ts",
    );

    const logs: string[] = [];
    (async () => {
      for await (const log of helloWorld.logs) {
        logs.push(log);
      }
    })();

    await helloWorld.run(async function () {
      await this.fetch("/");
      assertEquals(logs, ["fetch\n", "https://localhost/\n"]);
    });
  },
});