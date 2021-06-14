// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker } from "../mod.ts";
import { assertEquals, assertStrictEquals } from "../test_deps.ts";

Deno.test({
  name: "Deno namespace - expected",
  async fn() {
    const worker = await createWorker("./tests/fixtures/deno_ns.js");
    await worker.run(async () => {
      const [response] = await worker.fetch("/");
      const actual: {
        env: Record<string, string>;
        noColor: string;
        build: typeof Deno.build;
        customInspect: string;
        inspect: string;
        keys: string[];
      } = await response.json();
      assertEquals(actual.keys.sort(), [
        "build",
        "customInspect",
        "env",
        "inspect",
        "noColor",
      ]);
      assertEquals(actual.build, {
        target: "x86_64-unknown-linux-gnu",
        arch: "x86_64",
        os: "linux",
        vendor: "unknown",
        env: "gnu",
      });
      assertEquals(actual.env, { DENO_DEPLOYMENT_ID: "00000000" });
      assertStrictEquals(actual.noColor, true);
      assertStrictEquals(actual.customInspect, "symbol");
      assertStrictEquals(actual.inspect, "function");
    });
  },
});

Deno.test({
  name: "Deno.env - can set values",
  async fn() {
    const worker = await createWorker("./tests/fixtures/deno_ns.js", {
      env: { DENO_DEPLOYMENT_ID: "ffffffff", A: "B" },
    });
    await worker.run(async () => {
      const [response] = await worker.fetch("/");
      const actual: { env: Record<string, string> } = await response.json();
      assertEquals(actual.env, { DENO_DEPLOYMENT_ID: "ffffffff", A: "B" });
    });
  },
});
