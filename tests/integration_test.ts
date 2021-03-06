// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { createWorker, testing } from "../mod.ts";
import { assertEquals, assertStrictEquals } from "../test_deps.ts";

Deno.test({
  name: "Deno namespace - expected",
  async fn() {
    const worker = await createWorker("./tests/fixtures/deno_ns.js");
    await worker.run(async () => {
      const [response] = await worker.fetch("/");
      const actual: {
        build: typeof Deno.build;
        customInspect: string;
        env: Record<string, string>;
        inspect: string;
        listen: string;
        noColor: boolean;
        readFile: string;
        readTextFile: string;
        serveHttp: string;
        keys: string[];
      } = await response.json();
      assertEquals(actual.keys.sort(), [
        "build",
        "customInspect",
        "env",
        "inspect",
        "listen",
        "noColor",
        "readFile",
        "readTextFile",
        "serveHttp",
      ]);
      assertEquals(actual.build, {
        target: "x86_64-unknown-linux-gnu",
        arch: "x86_64",
        os: "linux",
        vendor: "unknown",
        env: "gnu",
      });
      assertStrictEquals(actual.customInspect, "symbol");
      assertEquals(actual.env, { DENO_DEPLOYMENT_ID: "00000000" });
      assertStrictEquals(actual.inspect, "function");
      assertStrictEquals(actual.listen, "function");
      assertStrictEquals(actual.noColor, false);
      assertStrictEquals(actual.readFile, "function");
      assertStrictEquals(actual.readTextFile, "function");
      assertStrictEquals(actual.serveHttp, "function");
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

Deno.test({
  name: "default request headers set",
  async fn() {
    const worker = await createWorker("./tests/fixtures/request_headers.js");
    await worker.run(async () => {
      const [response] = await worker.fetch("/");
      assertEquals(Object.fromEntries((await response.json()).headers), {
        host: "localhost",
        "x-forwarded-for": "127.0.0.1",
      });
    });
  },
});
