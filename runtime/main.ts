// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { DectylConsole } from "./console.ts";
import { customInspect, inspect } from "./inspect.ts";
import type { DectylMessage, FetchMessageRequestInit } from "../types.d.ts";
import { assert, Deferred, parseBodyInit, parseHeaders } from "../lib/util.ts";

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

class DeployDenoNs {
  #env = new Map([["DENO_DEPLOYMENT_ID", "00000000"]]);

  create(): typeof Deno {
    const build = {
      target: "x86_64-unknown-linux-gnu",
      arch: "x86_64",
      os: "linux",
      vendor: "unknown",
      env: "gnu",
    };

    const env = {
      get: (key: string): string | undefined => {
        return this.#env.get(key);
      },
      set: (_key: string, _value: string) => {
        throw new TypeError("Can not modify env vars during execution.");
      },
      delete: (_key: string): boolean => {
        throw new TypeError("Can not modify env vars during execution.");
      },
      toObject: (): Record<string, string> => {
        return Object.fromEntries(this.#env);
      },
    };

    return Object.create({}, {
      "build": createReadOnly(build),
      "customInspect": createReadOnly(customInspect),
      "env": createReadOnly(env),
      "inspect": createReadOnly(inspect),
      "noColor": createValueDesc(false),
    });
  }

  setEnv(obj: Record<string, string>) {
    for (const [key, value] of Object.entries(obj)) {
      this.#env.set(key, value);
    }
  }
}

class DeployWorkerHost {
  #bodyControllers = new Map<
    number,
    ReadableStreamDefaultController<Uint8Array>
  >();
  #denoNs: DeployDenoNs;
  #fetch = globalThis.fetch.bind(globalThis);
  #fetchId = 1;
  #hasFetchHandler = false;
  #pendingFetches = new Map<number, Deferred<Response>>();
  #postMessage: (message: DectylMessage) => void = globalThis.postMessage.bind(
    globalThis,
  );
  #responseBodyControllers = new Map<
    number,
    ReadableStreamDefaultController<Uint8Array>
  >();
  #signalControllers = new Map<number, AbortController>();
  #signalId = 1;
  #target: EventTarget;

  async #handleMessage(evt: MessageEvent<DectylMessage>) {
    const { data } = evt;
    this.#log(LogLevel.Debug, "#handleMessage", data);
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
        const { id, chunk, subType } = data;
        if (subType === "request") {
          const bodyController = this.#bodyControllers.get(id);
          assert(bodyController);
          bodyController.enqueue(chunk);
        } else {
          const responseBodyController = this.#responseBodyControllers.get(id);
          assert(responseBodyController);
          responseBodyController.enqueue(chunk);
        }
        break;
      }
      case "bodyClose": {
        const { id, subType } = data;
        if (subType === "request") {
          const bodyController = this.#bodyControllers.get(id);
          assert(bodyController);
          bodyController.close();
          this.#bodyControllers.delete(id);
        } else {
          const responseBodyController = this.#responseBodyControllers.get(id);
          assert(responseBodyController);
          responseBodyController.close();
          this.#responseBodyControllers.delete(id);
        }
        break;
      }
      case "bodyError": {
        const { id, error, subType } = data;
        if (subType === "request") {
          const bodyController = this.#bodyControllers.get(id);
          assert(bodyController);
          bodyController.error(error);
          this.#bodyControllers.delete(id);
        } else {
          const responseBodyController = this.#responseBodyControllers.get(id);
          assert(responseBodyController);
          responseBodyController.error(error);
          this.#responseBodyControllers.delete(id);
        }
        break;
      }
      case "init": {
        const { env, hasFetchHandler = false } = data.init;
        if (env) {
          this.#denoNs.setEnv(env);
        }
        this.#hasFetchHandler = hasFetchHandler;
        this.#postMessage({ type: "ready" });
        break;
      }
      case "import":
        await import(data.specifier);
        this.#postMessage({ type: "loaded" });
        break;
      case "fetch": {
        const { id, init } = data;
        const [input, requestInit] = this.#parseInit(id, init);
        this.#target.dispatchEvent(
          new FetchEvent(
            new Request(input, requestInit),
            (response) => this.#postResponse(id, response),
          ),
        );
        break;
      }
      case "respond": {
        const { id, hasBody, type: _, ...responseInit } = data;
        let bodyInit: ReadableStream<Uint8Array> | null = null;
        if (hasBody) {
          bodyInit = new ReadableStream({
            start: (controller) => {
              this.#responseBodyControllers.set(id, controller);
            },
          });
        }
        const response = new Response(bodyInit, responseInit);
        const deferred = this.#pendingFetches.get(id);
        assert(deferred);
        this.#pendingFetches.delete(id);
        deferred.resolve(response);
        break;
      }
      case "respondError": {
        const { id, message, name } = data;
        const error = new Error(message);
        error.name = name;
        const deferred = this.#pendingFetches.get(id);
        assert(deferred);
        this.#pendingFetches.delete(id);
        deferred.reject(error);
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

  async #postResponse(id: number, res: Response | Promise<Response>) {
    let response: Response;
    try {
      response = await res;
    } catch (err) {
      assert(err instanceof Error);
      this.#postMessage({
        type: "respondError",
        id,
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      return;
    }
    const { body, headers, status, statusText } = response;
    this.#postMessage({
      type: "respond",
      id,
      hasBody: body != null,
      headers: [...headers],
      status,
      statusText,
    });
    const subType = "response";
    if (body) {
      try {
        for await (const chunk of body) {
          this.#postMessage({
            type: "bodyChunk",
            id,
            chunk,
            subType,
          });
        }
      } catch (error) {
        this.#postMessage({
          type: "bodyError",
          id,
          error,
          subType,
        });
      }
      this.#postMessage({
        type: "bodyClose",
        id,
        subType,
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

  async #streamBody(id: number, body: ReadableStream<Uint8Array>) {
    const subType = "request";
    try {
      for await (const chunk of body) {
        this.#postMessage({
          type: "bodyChunk",
          id,
          chunk,
          subType,
        });
      }
    } catch (error) {
      this.#postMessage({
        type: "bodyError",
        id,
        error,
        subType,
      });
    }
    this.#postMessage({
      type: "bodyClose",
      id,
      subType,
    });
  }

  #watchSignal(signal?: AbortSignal | null): number | undefined {
    if (!signal) {
      return;
    }
    const id = this.#signalId++;
    signal.addEventListener("abort", () => {
      this.#postMessage({
        type: "abort",
        id,
      });
    });
    return id;
  }

  constructor() {
    addEventListener("message", (evt: MessageEvent) => {
      this.#handleMessage(evt);
    });

    const console = new DectylConsole(this.#print.bind(this));
    const target = this.#target = new EventTarget();
    const denoNs = this.#denoNs = new DeployDenoNs();

    Object.defineProperties(globalThis, {
      "addEventListener": createValueDesc(
        target.addEventListener.bind(target),
      ),
      "console": createNonEnumDesc(console),
      "Deno": createReadOnly(denoNs.create()),
      "dispatchEvent": createValueDesc(
        target.dispatchEvent.bind(target),
      ),
      "fetch": createValueDesc(this.fetch.bind(this)),
      "removeEventListener": createValueDesc(
        target.removeEventListener.bind(target),
      ),
    });
  }

  fetch(
    input: Request | URL | string,
    requestInit?: RequestInit,
  ): Promise<Response> {
    if (!this.#hasFetchHandler) {
      return this.#fetch(input, requestInit);
    }
    const id = this.#fetchId++;
    const deferred = new Deferred<Response>();
    this.#pendingFetches.set(id, deferred);
    const init: FetchMessageRequestInit = {
      body: { type: "null" },
      url: "",
    };
    let inputRequest: Request | undefined;
    let bodyStream: ReadableStream<Uint8Array> | undefined;
    let url: URL;
    if (typeof input === "string") {
      url = new URL(input);
      init.url = url.toString();
    } else if (input instanceof URL) {
      url = input;
      init.url = input.toString();
    } else if (input instanceof Request) {
      url = new URL(input.url);
      init.url = url.toString();
      inputRequest = input;
    } else {
      throw new TypeError("Argument `input` is of an unsupported type.");
    }
    const defaultHeaders: Record<string, string> = {
      host: url.host,
      "x-forwarded-for": "127.0.0.1",
    };
    if (requestInit && inputRequest) {
      let headers: [string, string][] | undefined;
      if (requestInit.body != null) {
        [init.body, bodyStream, headers] = parseBodyInit(
          inputRequest ?? init.url,
          requestInit,
        );
      } else if (inputRequest.body) {
        bodyStream = inputRequest.body;
        init.body = {
          type: "stream",
        };
      }
      init.headers = parseHeaders(
        defaultHeaders,
        headers ?? requestInit.headers ?? inputRequest.headers,
      );
      init.signal = this.#watchSignal(
        requestInit.signal ?? inputRequest.signal,
      );
      for (const key of INIT_PROPS) {
        // deno-lint-ignore no-explicit-any
        init[key] = requestInit[key] ?? inputRequest[key] as any;
      }
    } else if (requestInit) {
      let headers: [string, string][] | undefined;
      if (requestInit.body != null) {
        [init.body, bodyStream, headers] = parseBodyInit(
          inputRequest ?? init.url,
          requestInit,
        );
      }
      init.headers = parseHeaders(
        defaultHeaders,
        headers ?? requestInit.headers,
      );
      init.signal = this.#watchSignal(requestInit.signal);
      for (const key of INIT_PROPS) {
        // deno-lint-ignore no-explicit-any
        init[key] = requestInit[key] as any;
      }
    } else if (inputRequest) {
      if (inputRequest.body) {
        bodyStream = inputRequest.body;
        init.body = {
          type: "stream",
        };
      }
      init.headers = parseHeaders(defaultHeaders, inputRequest.headers);
      init.signal = this.#watchSignal(inputRequest.signal);
      for (const key of INIT_PROPS) {
        // deno-lint-ignore no-explicit-any
        init[key] = inputRequest[key] as any;
      }
    } else {
      init.headers = parseHeaders(defaultHeaders);
    }
    this.#postMessage({
      type: "fetch",
      id,
      init,
    });
    if (bodyStream) {
      this.#streamBody(id, bodyStream);
    }
    return deferred.promise;
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

function createReadOnly(value: unknown): PropertyDescriptor {
  return {
    value,
    writable: false,
    enumerable: true,
    configurable: false,
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
