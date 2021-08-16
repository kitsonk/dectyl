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

type RespondWith = (response: Response | Promise<Response>) => Promise<void>;

class FetchEvent extends Event {
  #request: Request;
  #respondWith: RespondWith;
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
    respondWith: RespondWith,
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

class RequestEvent {
  #request: Request;
  #respondWith: RespondWith;

  get request(): Request {
    return this.#request;
  }

  constructor(
    request: Request,
    respondWith: RespondWith,
  ) {
    this.#request = request;
    this.#respondWith = respondWith;
  }

  // this needs to be lexically bound to support destructuring
  respondWith = (r: Response | Promise<Response>): Promise<void> => {
    return this.#respondWith(r);
  };
}

let globalRid = 0;

class HttpConn implements AsyncIterable<RequestEvent> {
  #closed = false;
  #requestEvent: Promise<RequestEvent>;
  #rid = globalRid++;

  get rid(): number {
    return this.#rid;
  }

  constructor(requestEvent: Promise<RequestEvent>) {
    this.#requestEvent = requestEvent;
  }

  async nextRequest(): Promise<RequestEvent | null> {
    if (this.#closed) {
      return null;
    }
    const next = await this[Symbol.asyncIterator]().next();
    return next.value ?? null;
  }
  close(): void {
    this.#closed = true;
  }
  async *[Symbol.asyncIterator](): AsyncIterator<RequestEvent> {
    if (this.#closed) {
      return;
    }
    const requestEvent = await this.#requestEvent;
    yield requestEvent;
    this.#closed = true;
  }
}

function createConn(
  input: string,
  requestInit: RequestInit,
  respondWith: RespondWith,
): Conn {
  const request = new Request(input, requestInit);
  const requestEvent = new RequestEvent(request, respondWith);
  const conn = new Conn();
  requestEventPromises.set(conn, Promise.resolve(requestEvent));
  return conn;
}

class Conn {}

const requestEventPromises = new WeakMap<Conn, Promise<RequestEvent>>();

function serveHttp(conn: Conn) {
  const promise = requestEventPromises.get(conn);
  assert(promise);
  return new HttpConn(promise);
}

export interface NetAddr {
  transport: "tcp";
  hostname: string;
  port: number;
}

let globalListener: Listener | undefined;

class Listener implements AsyncIterable<Conn> {
  #addr: NetAddr;
  #closed = false;
  #requestStream: ReadableStream<[string, RequestInit, RespondWith]>;
  #rid = globalRid++;

  get addr(): NetAddr {
    return this.#addr;
  }
  get rid(): number {
    return this.#rid;
  }

  constructor(
    addr: NetAddr,
    requestStream: ReadableStream<[string, RequestInit, RespondWith]>,
  ) {
    this.#addr = addr;
    this.#requestStream = requestStream;
  }

  async accept(): Promise<Conn> {
    if (this.#closed) {
      throw new Error("the listener is closed");
    }

    if (this.#requestStream.locked) {
      throw new Error("Request Stream Locked");
    }

    const reader = this.#requestStream.getReader();
    const result = await reader.read();
    reader.releaseLock();
    if (result.value) {
      return createConn(...result.value);
    }
    this.#closed = true;
    throw new Error("the listener is closed");
  }

  close(): void {
    this.#closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<Conn> {
    for await (const args of this.#requestStream) {
      yield createConn(...args);
    }
  }
}

let globalRequestStream: ReadableStream<[string, RequestInit, RespondWith]>;

function listen(
  { port, hostname = "127.0.0.1" }: { port: number; hostname?: string },
): Listener {
  if (globalListener) {
    throw new TypeError(
      "dectyl currently only supports on listener per runtime",
    );
  }
  if (port === 0) {
    port = 80;
  }
  assert(globalRequestStream);
  return globalListener = new Listener(
    { port, hostname, transport: "tcp" },
    globalRequestStream,
  );
}

class DeployDenoNs {
  #env = new Map([["DENO_DEPLOYMENT_ID", "00000000"]]);

  create(host: DeployWorkerHost): typeof Deno {
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

    async function readFile(path: URL | string): Promise<Uint8Array> {
      if (path instanceof URL && path.protocol !== "file:") {
        const res = await host.fetch(path);
        return new Uint8Array(await res.arrayBuffer());
      }
      return host.readFile(String(path));
    }

    const decoder = new TextDecoder();

    async function readTextFile(path: URL | string) {
      if (path instanceof URL) {
        const res = await host.fetch(path);
        return res.text();
      }
      return decoder.decode(await host.readFile(path));
    }

    return Object.create({}, {
      "build": createReadOnly(build),
      "customInspect": createReadOnly(customInspect),
      "env": createReadOnly(env),
      "inspect": createReadOnly(inspect),
      "listen": createReadOnly(listen),
      "noColor": createValueDesc(false),
      "readFile": createReadOnly(readFile),
      "readTextFile": createReadOnly(readTextFile),
      "serveHttp": createReadOnly(serveHttp),
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
  #pendingReadFiles = new Map<number, Deferred<Uint8Array>>();
  #postMessage: (
    message: DectylMessage,
    options?: StructuredSerializeOptions,
  ) => void = globalThis.postMessage.bind(
    globalThis,
  );
  #readFileId = 1;
  #requestEventController!: ReadableStreamDefaultController<
    [string, RequestInit, RespondWith]
  >;
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
        if (globalListener) {
          this.#requestEventController.enqueue([
            input,
            requestInit,
            (response) => this.#postResponse(id, response),
          ]);
        } else {
          this.#target.dispatchEvent(
            new FetchEvent(
              new Request(input, requestInit),
              (response) => this.#postResponse(id, response),
            ),
          );
        }
        break;
      }
      case "readFileResponse": {
        const { id, error, value } = data;
        const deferred = this.#pendingReadFiles.get(id);
        assert(deferred);
        this.#pendingReadFiles.delete(id);
        if (error) {
          const err = new Error(error.message);
          err.name = error.name;
          err.stack = error.stack;
          deferred.reject(err);
        } else {
          assert(value);
          deferred.resolve(value);
        }
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
    requestInit.headers = init.headers;
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

    globalRequestStream = new ReadableStream({
      start: (controller) => {
        this.#requestEventController = controller;
      },
    });

    const console = new DectylConsole(this.#print.bind(this));
    const target = this.#target = new EventTarget();
    const denoNs = this.#denoNs = new DeployDenoNs();

    Object.defineProperties(globalThis, {
      "addEventListener": createValueDesc(
        target.addEventListener.bind(target),
      ),
      "console": createNonEnumDesc(console),
      "Deno": createReadOnly(denoNs.create(this)),
      "dispatchEvent": createValueDesc(
        target.dispatchEvent.bind(target),
      ),
      "fetch": createValueDesc(this.fetch.bind(this)),
      "removeEventListener": createValueDesc(
        target.removeEventListener.bind(target),
      ),
    });
  }

  readFile(path: string): Promise<Uint8Array> {
    const id = this.#readFileId++;
    const deferred = new Deferred<Uint8Array>();
    this.#pendingReadFiles.set(id, deferred);
    this.#postMessage({ type: "readFile", id, path });
    return deferred.promise;
  }

  fetch(
    input: Request | URL | string,
    requestInit?: RequestInit,
  ): Promise<Response> {
    if (!this.#hasFetchHandler) {
      return this.#fetch(input, requestInit);
    }
    this.#log(LogLevel.Debug, "fetch()", { input, requestInit });
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
