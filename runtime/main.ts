// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { DectylConsole } from "./console.ts";
import type { DectylMessage, FetchMessageRequestInit } from "../types.d.ts";

import "https://raw.githubusercontent.com/kitsonk/deno_local_file_fetch/main/polyfill.ts";

const INIT_PROPS = [
  "cache",
  "credentials",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
] as const;

const inspect = globalThis.Deno.inspect.bind(Deno);

function assert(cond: unknown, msg = "Assertion failed"): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

class FetchEvent extends Event {
  #request: Request;
  #respondWith: (response: Response | Promise<Response>) => Promise<void>;
  #responded = false;

  get request() {
    return this.#request;
  }

  /**
   * @param {Request} request
   * @param {Response | Promise<Response>} respondWith
   */
  constructor(
    request: Request,
    respondWith: (response: Response | Promise<Response>) => Promise<void>,
  ) {
    super("fetch");
    this.#request = request;
    this.#respondWith = respondWith;
  }

  respondWith(response: Response | Promise<Response>) {
    if (this.#responded === true) {
      throw new TypeError("Already responded to this FetchEvent.");
    } else {
      this.#responded = true;
    }
    // deno-lint-ignore no-explicit-any
    this.#respondWith(response).catch((err: any) => console.warn(err));
  }

  [Symbol.toStringTag]() {
    return "FetchEvent";
  }
}

Object.assign(globalThis, {
  FetchEvent,
});

class DeployContext extends EventTarget {
  //
}

class DeployWorkerHost {
  #bodyControllers = new Map<
    number,
    ReadableStreamDefaultController<Uint8Array>
  >();
  #context: DeployContext;
  #postMessage: (message: DectylMessage) => void = globalThis.postMessage.bind(
    globalThis,
  );
  #signalControllers = new Map<number, AbortController>();

  async #handleMessage(evt: MessageEvent<DectylMessage>) {
    const { data } = evt;
    switch (data.type) {
      case "abort": {
        const { id } = data;
        const controller = this.#signalControllers.get(id);
        if (controller) {
          controller.abort();
          this.#signalControllers.delete(id);
        }
        break;
      }
      case "bodyChunk": {
        const { id, chunk } = data;
        const bodyController = this.#bodyControllers.get(id);
        assert(bodyController);
        bodyController.enqueue(chunk);
        break;
      }
      case "bodyClose": {
        const { id } = data;
        const bodyController = this.#bodyControllers.get(id);
        assert(bodyController);
        bodyController.close();
        this.#bodyControllers.delete(id);
        break;
      }
      case "bodyError": {
        const { id, error } = data;
        const bodyController = this.#bodyControllers.get(id);
        assert(bodyController);
        bodyController.error(error);
        this.#bodyControllers.delete(id);
        break;
      }
      case "init":
        this.#postMessage({ type: "ready" });
        break;
      case "import":
        await import(data.specifier);
        this.#postMessage({ type: "loaded" });
        break;
      case "fetch": {
        const { id, init } = data;
        const [input, requestInit] = this.#parseInit(id, init);
        this.#context.dispatchEvent(
          new FetchEvent(
            new Request(input, requestInit),
            (response) => this.#postResponse(id, response),
          ),
        );
        break;
      }
      default:
        console.error(
          `error: [${self.name}] Unhandled message type: "${data.type}"`,
        );
    }
  }

  #log(level: LogLevel, ...data: unknown[]) {
    this.#postMessage({
      type: "internalLog",
      level,
      messages: data.map((v) => typeof v === "string" ? v : inspect(v)),
    });
  }

  #parseInit(id: number, init: FetchMessageRequestInit): [string, RequestInit] {
    const requestInit: RequestInit = {};
    switch (init.body.type) {
      case "null":
        requestInit.body = null;
        break;
      case "cloned":
        requestInit.body = init.body.value as string | Blob | BufferSource;
        break;
      case "urlsearchparams":
        requestInit.body = new URLSearchParams(
          init.body.value as [string, string][],
        );
        break;
      case "stream":
        assert(!this.#bodyControllers.has(id));
        requestInit.body = new ReadableStream({
          start: (controller) => {
            this.#bodyControllers.set(id, controller);
          },
        });
    }
    if (init.signal) {
      assert(!this.#signalControllers.has(id));
      const controller = new AbortController();
      this.#signalControllers.set(id, controller);
      requestInit.signal = controller.signal;
    }
    for (const key of INIT_PROPS) {
      // deno-lint-ignore no-explicit-any
      requestInit[key] = init[key] as any;
    }

    return [init.url, requestInit];
  }

  async #postResponse(id: number, response: Response | Promise<Response>) {
    const { body, headers, status, statusText } = await response;
    this.#postMessage({
      type: "respond",
      id,
      hasBody: body != null,
      headers: [...headers],
      status,
      statusText,
    });
    if (body) {
      try {
        for await (const chunk of body) {
          this.#postMessage({
            type: "bodyChunk",
            id,
            chunk,
          });
        }
      } catch (error) {
        this.#postMessage({
          type: "bodyError",
          id,
          error,
        });
      }
      this.#postMessage({
        type: "bodyClose",
        id,
      });
    }
  }

  #print(message: string, error: boolean) {
    this.#postMessage({
      type: "log",
      message,
      error,
    });
  }

  constructor() {
    addEventListener("message", (evt) => {
      this.#handleMessage(evt);
    });

    const console = new DectylConsole(this.#print.bind(this));

    const context = this.#context = new DeployContext();
    Object.defineProperties(globalThis, {
      "addEventListener": createValueDesc(
        context.addEventListener.bind(context),
      ),
      "console": createNonEnumDesc(console),
      "dispatchEvent": createValueDesc(
        context.dispatchEvent.bind(context),
      ),
      "removeEventListener": createValueDesc(
        context.removeEventListener.bind(context),
      ),
    });
  }
}

new DeployWorkerHost();

function createNonEnumDesc(value: unknown): PropertyDescriptor {
  return {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  };
}

function createValueDesc(value: unknown): PropertyDescriptor {
  return {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  };
}
