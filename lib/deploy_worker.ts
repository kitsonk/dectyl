// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

/// <reference lib="deno.unstable" />

import { assert } from "../deps.ts";
import * as logger from "./logger.ts";
import type {
  DectylMessage,
  DeployOptions,
  DeployWorkerInfo,
  FetchMessageBody,
  FetchMessageRequestInit,
  ImportMessage,
} from "../types.d.ts";
import {
  checkPermissions,
  checkUnstable,
  createBlobUrl,
  Deferred,
} from "./util.ts";

const BUNDLE_SPECIFIER = "deno:///bundle.js";
const RUNTIME_SCRIPT = "../runtime/main.bundle.js";
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

interface RequestResponseInfo {
  duration: number;
}

interface ListenOptions {
  port: number;
  hostname?: string;
  certFile?: string;
  keyFile?: string;
  alpnProtocols?: string[];
}

interface CheckOptions {
  includeLib?: boolean;
  includeFetchEvent?: boolean;
  includeCli?: boolean;
}

type DeployWorkerState =
  | "loading"
  | "stopped"
  | "running"
  | "errored"
  | "closing"
  | "closed";

interface DectylWorker extends Worker {
  postMessage(msg: DectylMessage): void;
}

export class DeployWorker {
  #base: URL;
  #bodyControllers = new Map<
    number,
    ReadableStreamDefaultController<Uint8Array>
  >();
  #fetchId = 1;
  #logs: ReadableStream<string>;
  #logsController!: ReadableStreamDefaultController<string>;
  #name: string;
  #pendingFetches = new Map<
    number,
    Deferred<[Response, RequestResponseInfo]>
  >();
  #ready = new Deferred<void>();
  #signalId = 1;
  #specifier: string | URL;
  #state: DeployWorkerState = "loading";
  #watch: boolean;
  #worker: DectylWorker;

  #handleMessage(evt: MessageEvent<DectylMessage>) {
    const { data } = evt;
    logger.debug("#handleMessage", data);
    switch (data.type) {
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
      case "internalLog": {
        const { level, messages } = data;
        logger.log(level, `[${this.#name}]`, ...messages);
        break;
      }
      case "loaded":
        assert(this.#state === "loading");
        this.#ready.resolve();
        this.#state = "stopped";
        break;
      case "log":
        this.#logsController.enqueue(
          `${data.error ? "error: " : ""}${data.message}`,
        );
        break;
      case "ready":
        assert(this.#state === "loading");
        this.#setup();
        break;
      case "respond": {
        const { id, hasBody, type: _, ...responseInit } = data;
        let bodyInit: ReadableStream<Uint8Array> | null = null;
        if (hasBody) {
          bodyInit = new ReadableStream({
            start: (controller) => {
              this.#bodyControllers.set(id, controller);
            },
          });
        }
        const response = new Response(bodyInit, responseInit);
        const deferred = this.#pendingFetches.get(id);
        assert(deferred);
        this.#pendingFetches.delete(id);
        deferred.resolve([response, { duration: 0 }]);
        break;
      }
      default:
        logger.warn(`Unhandled message type: "${data.type}"`);
    }
  }

  async #setup() {
    logger.debug("#setup");
    const { diagnostics, files } = await Deno.emit(this.#specifier, {
      bundle: "module",
      check: false,
      compilerOptions: {
        jsx: "react",
        jsxFactory: "h",
        jsxFragmentFactory: "Fragment",
        sourceMap: false,
      },
    });
    assert(diagnostics.length === 0);
    assert(files[BUNDLE_SPECIFIER]);
    const specifier = createBlobUrl(files[BUNDLE_SPECIFIER]);
    const importMessage: ImportMessage = {
      type: "import",
      specifier,
    };
    this.#worker.postMessage(importMessage);
  }

  async #streamBody(id: number, body: ReadableStream<Uint8Array>) {
    logger.debug("#streamBody", id);
    try {
      for await (const chunk of body) {
        if (!(this.#state === "running" || this.#state === "stopped")) {
          this.#worker.postMessage({
            type: "bodyClose",
            id,
          });
          return;
        }
        this.#worker.postMessage({
          type: "bodyChunk",
          id,
          chunk,
        });
      }
    } catch (error) {
      if (this.#state === "running" || this.#state === "stopped") {
        this.#worker.postMessage({
          type: "bodyError",
          id,
          error,
        });
      }
    }
    if (this.#state === "running" || this.#state === "stopped") {
      this.#worker.postMessage({
        type: "bodyClose",
        id,
      });
    }
  }

  #watchSignal(signal?: AbortSignal | null): number | undefined {
    if (!signal) {
      return;
    }
    logger.debug("#watchSignal");
    const id = this.#signalId++;
    signal.addEventListener("abort", () => {
      if (this.#state === "running" || this.#state === "stopped") {
        this.#worker.postMessage({
          type: "abort",
          id,
        });
      }
    });
    return id;
  }

  constructor(
    specifier: string | URL,
    { host = "localhost", name = createName(), watch = false, ...options }:
      DeployOptions = {},
  ) {
    logger.debug("DeployWorker.construct", {
      specifier,
      host,
      name,
      watch,
      options,
    });
    this.#logs = new ReadableStream({
      start: (controller) => {
        this.#logsController = controller;
      },
    });
    this.#specifier = specifier;
    this.#base = new URL(`https://${host}`);
    const script = (new URL(RUNTIME_SCRIPT, import.meta.url))
      .toString();
    this.#name = name;
    this.#watch = watch;
    this.#worker = new Worker(script, { name, type: "module" });
    this.#worker.addEventListener("message", (evt) => this.#handleMessage(evt));
    this.#worker.postMessage({
      type: "init",
      options,
    });
  }

  /** A readable stream the yields up log messages from the program.
   *
   * Example:
   *
   * ```ts
   * const helloWorld = await createWorker("./helloWorld.ts");
   * // Use an async IIFE to avoid blocking the main loop
   * (async () => {
   *   for await (const msg of helloWorld.logs) {
   *     console.log(`[${helloWorld.name}] ${msg}`);
   *   }
   * })();
   * await helloWorld.listen({ port: 8000 });
   * ```
   */
  get logs(): ReadableStream<string> {
    return this.#logs;
  }

  /** The name of the worker. */
  get name(): string {
    return this.#name;
  }

  /** A promise that resolves when the worker is initialized and ready. */
  get ready(): Promise<void> {
    return this.#ready.promise;
  }

  /** The current state of the worker. */
  get state(): DeployWorkerState {
    return this.#state;
  }

  /** Type check the program.
   *
   * **TO BE IMPLEMENTED**
   */
  check(_options: CheckOptions = {}): Promise<Deno.Diagnostic[]> {
    return Promise.resolve([]);
  }

  /** Close and terminate the worker. The worker will resolve when any pending
   * requests are settled. */
  async close(): Promise<void> {
    logger.debug("DeployWorker.close()", this.#name);
    this.#state = "closing";
    await Promise.allSettled(
      [...this.#pendingFetches.values()].map((v) => v.promise),
    );
    this.#worker.terminate();
    this.#state = "closed";
  }

  /** Send a request into the program and resolve with the resulting `Response`
   * and additional information about the request.
   *
   * For example:
   *
   * ```ts
   * const helloWorld = await createWorker("./hello_world.ts");
   * await helloWorld.run(async () => {
   *   const [response, info] = await helloWorld.fetch("/");
   *   // make assertions against the response
   * });
   * ```
   */
  fetch(
    input: string | Request | URL,
    requestInit?: RequestInit,
  ): Promise<[Response, RequestResponseInfo]> {
    assert(this.#state !== "loading" && this.#state !== "errored");
    if (this.#state === "closed" || this.#state === "closing") {
      return Promise.reject(new TypeError("The worker is closing or closed."));
    }
    if (this.#state === "stopped") {
      return Promise.reject(new TypeError("The worker is currently stopped."));
    }
    const id = this.#fetchId++;
    const deferred = new Deferred<[Response, RequestResponseInfo]>();
    this.#pendingFetches.set(id, deferred);
    const init: FetchMessageRequestInit = {
      body: { type: "null" },
      url: "",
    };
    let inputRequest: Request | undefined;
    let bodyStream: ReadableStream<Uint8Array> | undefined;
    let url: URL;
    if (typeof input === "string") {
      url = new URL(input, this.#base);
      init.url = url.toString();
    } else if (input instanceof URL) {
      url = input;
      init.url = input.toString();
    } else if (input instanceof Request) {
      url = new URL(input.url, this.#base);
      init.url = url.toString();
      inputRequest = input;
    } else {
      throw new TypeError("Argument `input` is of an unsupported type.");
    }
    logger.debug("fetch()", this.#name, init.url);
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
    this.#worker.postMessage({
      type: "fetch",
      id,
      init,
    });
    if (bodyStream) {
      this.#streamBody(id, bodyStream);
    }
    return deferred.promise;
  }

  /** Diagnostic information about the current worker. */
  info(): Promise<DeployWorkerInfo> {
    return Promise.resolve({
      fetchCount: this.#fetchId,
      pendingFetches: this.#pendingFetches.size,
    });
  }

  /** Start listening for requests, passing them to the worker and sending
   * the responses back to the client.
   *
   * Example:
   *
   * ```ts
   * const helloWorld = await createWorker("./helloWorld.ts");
   * await helloWorld.listen({ port: 8000 });
   * ```
   */
  async listen(options: ListenOptions): Promise<void> {
    await this.start();

    // deno-lint-ignore no-this-alias
    const worker = this;
    const listener = isTlsOptions(options)
      ? Deno.listenTls(options)
      : Deno.listen(options);

    async function serve(conn: Deno.Conn) {
      const httpConn = Deno.serveHttp(conn);
      while (true) {
        try {
          const requestEvent = await httpConn.nextRequest();
          if (requestEvent === null) {
            return;
          }
          const [response] = await worker.fetch(requestEvent.request);
          await requestEvent.respondWith(response);
        } catch (err) {
          logger.error(err);
        }
        if (worker.state !== "running") {
          return;
        }
      }
    }

    async function accept() {
      while (true) {
        try {
          const conn = await listener.accept();
          serve(conn);
        } catch (err) {
          logger.error(err);
        }
        if (worker.state !== "running") {
          return;
        }
      }
    }

    accept();
  }

  /** Start server and execute the callback.  Once the callback finishes, the
   * worker will be closed.  Run resolves or rejects with the value returned
   * from the callback.  The callback will be called with the context of the
   * worker.
   *
   * This is useful when you need to run a set of assertions against the worker
   * where the assertions might throw, but want to ensure the worker gets closed
   * irrespective of if the callback throws or not.
   *
   * Example:
   *
   * ```ts
   * const helloWorld = await createWorker("./helloWorld.ts");
   * await helloWorld.run(async function () {
   *   const [response, info] = await this.fetch("/");
   *   // make assertions against the response
   * });
   * ```
   */
  async run<T>(callback: (this: this) => T | Promise<T>): Promise<T> {
    await this.start();
    let result: T;
    try {
      result = await callback.call(this);
    } finally {
      await this.close();
    }
    return result;
  }

  /** Start the program, allowing it to take requests. */
  async start(): Promise<void> {
    await this.#ready.promise;
    assert(this.#state !== "loading" && this.#state !== "errored");
    if (this.#state === "closed" || this.#state === "closing") {
      return Promise.reject(new TypeError("The worker is closing or closed."));
    }
    if (this.#state === "stopped") {
      this.#state = "running";
    }
  }

  /** Stop the program, preventing it from taking new requests. The program can
   * be restarted. */
  async stop(): Promise<void> {
    assert(this.#state !== "loading" && this.#state !== "errored");
    if (this.#state === "closed" || this.#state === "closing") {
      return Promise.reject(new TypeError("The worker is closing or closed."));
    }
    if (this.#state === "running") {
      await Promise.allSettled(
        [...this.#pendingFetches.values()].map((v) => v.promise),
      );
      this.#state = "stopped";
    }
  }
}

/** Create a web worker which runs the provided module and its dependencies in
 * a Deploy-like environment, and returns an API to interact with the loaded
 * program. */
export async function createWorker(
  specifier: string | URL,
  options: DeployOptions = {},
): Promise<DeployWorker> {
  checkUnstable();
  await checkPermissions(specifier);
  const worker = new DeployWorker(specifier, options);
  await worker.ready;
  return worker;
}

let uid = 0;

function createName(): string {
  return `dectyl_${String(uid++).padStart(3, "0")}`;
}

function parseBodyInit(
  input: string | Request,
  requestInit: RequestInit,
): [
  FetchMessageBody,
  ReadableStream<Uint8Array> | undefined,
  [string, string][] | undefined,
] {
  assert(requestInit.body);
  if (requestInit.body instanceof ReadableStream) {
    return [{ type: "stream" }, requestInit.body, undefined];
  }
  if (requestInit.body instanceof URLSearchParams) {
    const value = [...requestInit.body];
    return [{ type: "urlsearchparams", value }, undefined, undefined];
  }
  if (requestInit.body instanceof FormData) {
    const request = new Request(input, requestInit);
    assert(request.body);
    const headers = [...request.headers];
    return [
      { type: "stream" },
      request.body,
      headers.length ? headers : undefined,
    ];
  }
  return [{ type: "cloned", value: requestInit.body }, undefined, undefined];
}

function parseHeaders(
  defaultHeaders: Record<string, string>,
  headers?: HeadersInit,
): [string, string][] {
  const h = new Headers(headers);
  for (const [key, value] of Object.entries(defaultHeaders)) {
    if (!h.has(key)) {
      h.set(key, value);
    }
  }
  return [...h];
}

function isTlsOptions(value: ListenOptions): value is Deno.ListenTlsOptions {
  return "certFile" in value && "keyFile" in value;
}
