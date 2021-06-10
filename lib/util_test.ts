// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { assert } from "../deps.ts";
import { createBlobUrl } from "./util.ts";

Deno.test({
  name: "createDataUrl - basic",
  fn() {
    const url = createBlobUrl(`console.log("hello world!")`);
    assert(url.startsWith("blob:null/"));
  },
});
