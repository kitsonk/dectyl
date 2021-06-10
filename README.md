# dectyl

APIs for testing [Deno Deploy](https://deno.com/deploy) scripts using the
[Deno CLI](https://deno.land/).

The library loads and bundles scripts targetting Deploy and loads them into a
web worker that provides a Deploy like environment on your local machine,
running under the Deno CLI.

## Usage

These APIs are designed to run under Deno CLI 1.11 or later. For more
information on installing the Deno CLI, see the
[installation](https://deno.land/#installation) section on the Deno CLI website.

The main features of the APIs are available via the `mod.ts` module. The
examples in this readme use an "untagged" version of the library, but for
real-world usage, it is best to leverage a "pinned" version of the library.

For example, if you want to use v0.1.0 of the library, you would import it like
this:

```ts
import * as dectyl from "https://deno.land/x/dectyl@0.1.0/mod.ts";
```

The library uses unstable Deno CLI APIs. Therefore when running a script that
uses dectyl, you need to supply the `--unstable` argument:

```
$ deno run --unstable main.ts
```

If the unstable APIs don't appear to be available when using dectyl, an error
will be thrown when attempting to create a local Deploy worker.

In order to access Deploy scripts and other resources, dectyl needs read and net
access when running under the Deno CLI. The library will prompt you for these if
they are not supplied on the command line:

```
⚠️  ️Deno requests read access. Allow? [y/n (y = yes allow, n = no deny)] 
⚠️  ️Deno requests network access. Allow? [y/n (y = yes allow, n = no deny)]
```

If the permissions aren't granted, a permission denied error will be thrown. The
prompts can be avoided by providing the `--allow-net` and `--allow-read` access
on startup:

```
$ deno run --unstable --allow-read --allow-net main.ts
```

> ℹ️ Future versions of the library will try to only ask for more narrow
> permissions, but this requires some additional Deno CLI APIs to facilitate.

### `createWorker()`

This is the main function of the library, which creates the Deploy-like web
worker. It takes one or two arguments:

- `specifier: string | URL` - (_required_) This is the entry point of your
  Deploy application you wish to run. This can be a string path to your current
  working directory, a fully qualified string URI, or a URL object. dectyl will
  take this and attempt to load and bundle the specified module and all of its
  dependencies and run it in a web worker that provides a Deploy-like
  environment on your local machine.
- `options: DeployOptions` - (_optional_) A set of options that impact the
  behavior of the worker runtime:
  - `env: Record<string, string>` - (_optional_) Sets the environment variables
    which can be access by the Deploy script when it runs.
  - `host: string` - (_optional_) The hostname (and possible port) to use as a
    base for sending requests into the worker. This is used when the request
    does not contain a base, like `.fetch("/")`. Passing a fully qualified URL
    on `.fetch()` would not utilize this. It defaults of `localhost`.
  - `name: string` - (_optional_) The name to assign to the worker. This is
    useful to disambiguate when you are running multiple workers. This defaults
    to an unique auto-generated name.
  - `watch: boolean` - (_optional_) _Not yet implemented_

It will create an instance of `DeployWorker` and resolve it asynchronously.

If I had the following Deploy script saved locally as `hello_world.ts` and I was
going to make a `hello_world_test.ts` besides it, and wanted to use Deno CLI's
built in test harness, it would look something like this:

**hello_world.ts**

```ts
addEventListener("fetch", (event) => {
  const response = new Response("Hello World!", {
    headers: { "content-type": "text/plain" },
  });
  event.respondWith(response);
});
```

**hello_world_test.ts**

```ts
import { createWorker } from "https://deno.land/dectyl/mod.ts";
import { assertEquals } from "https://deno.land/std/testing/asserts.ts";

Deno.test({
  name: "basic hello-world test",
  async fn() {
    const helloWorld = await createWorker(
      "./examples/deploy_scripts/hello_world.ts",
    );
    await helloWorld.start();
    const [response] = await helloWorld.fetch("/");
    assertEquals(await response.text(), "Hello World!");
    assertEquals([...response.headers], [["content-type", "text/plain"]]);
    helloWorld.close();
  },
});
```
