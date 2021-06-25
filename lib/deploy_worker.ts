// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

/// <reference lib="deno.unstable" />

import * as logger from "./logger.ts";
import type {
  DectylMessage,
  DeployOptions,
  DeployWorkerInfo,
  FetchMessageRequestInit,
  ImportMessage,
} from "../types.d.ts";
import {
  assert,
  checkPermissions,
  checkUnstable,
  createBlobUrl,
  Deferred,
  parseBodyInit,
  parseHeaders,
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

class RequestEvent implements Deno.RequestEvent {
  #bodyController?: ReadableStreamDefaultController<Uint8Array>;
  #finalized = false;
  #id: number;
  #init: FetchMessageRequestInit;
  #request?: Request;
  #response?: Response | Promise<Response>;
  #responded = new Deferred<void>();
  #signalController?: AbortController;
  #worker: DectylWorker;

  #parseInit(init: FetchMessageRequestInit): [string, RequestInit] {
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
        requestInit.body = new ReadableStream({
          start: (controller) => {
            this.#bodyController = controller;
          },
        });
    }
    if (init.signal) {
      const controller = this.#signalController = new AbortController();
      requestInit.signal = controller.signal;
    }
    for (const key of INIT_PROPS) {
      // deno-lint-ignore no-explicit-any
      requestInit[key] = init[key] as any;
    }

    return [init.url, requestInit];
  }

  get request(): Request {
    if (this.#request) {
      return this.#request;
    }
    return this.#request = new Request(...this.#parseInit(this.#init));
  }

  constructor(worker: DectylWorker, id: number, init: FetchMessageRequestInit) {
    this.#id = id;
    this.#init = init;
    this.#worker = worker;
  }

  abort() {
    this.#signalController?.abort();
  }

  close() {
    this.#bodyController?.close();
  }

  enqueue(chunk: Uint8Array) {
    if (!this.#bodyController) {
      throw new Error("Response does not have a body controller.");
    }
    this.#bodyController.enqueue(chunk);
  }

  // deno-lint-ignore no-explicit-any
  error(error: any) {
    this.#bodyController?.error(error);
  }

  async finalize() {
    if (this.#finalized) {
      return;
    }
    this.#finalized = true;
    assert(this.#request);
    const id = this.#id;
    let response: Response;
    try {
      response = await (this.#response ?? fetch(this.#request));
    } catch (err) {
      assert(err instanceof Error);
      const { message, name } = err;
      this.#worker.postMessage({
        type: "respondError",
        id,
        message,
        name,
      });
      return;
    }
    const { body, headers, status, statusText } = response;
    this.#worker.postMessage({
      type: "respond",
      id,
      hasBody: body != null,
      headers: [...headers],
      status,
      statusText,
    });
    if (body) {
      const subType = "response";
      try {
        for await (const chunk of body) {
          this.#worker.postMessage({ type: "bodyChunk", id, chunk, subType });
        }
      } catch (error) {
        this.#worker.postMessage({ type: "bodyError", id, error, subType });
      }
      this.#worker.postMessage({ type: "bodyClose", id, subType });
    }
  }

  respondWith(response: Response | Promise<Response>): Promise<void> {
    if (this.#response) {
      throw new TypeError("respondWith has already been called.");
    }
    this.#response = response;
    return this.#responded.promise;
  }

  [Symbol.for("Deno.customInspect")](inspect: (value: unknown) => string) {
    return `${this.constructor.name} ${
      inspect({
        request: this.request,
        respondWith: this.respondWith,
      })
    }`;
  }
}

export class DeployWorker {
  #base: URL;
  #bodyControllers = new Map<
    number,
    ReadableStreamDefaultController<Uint8Array>
  >();
  #fetchHandler?: (evt: Deno.RequestEvent) => Promise<void> | void;
  #fetchId = 1;
  #logs: ReadableStream<string>;
  #logsController!: ReadableStreamDefaultController<string>;
  #name: string;
  #pendingFetches = new Map<
    number,
    Deferred<[Response, RequestResponseInfo]>
  >();
  #ready = new Deferred<void>();
  #pendingRequests = new Map<number, RequestEvent>();
  #signalId = 1;
  #specifier: string | URL;
  #state: DeployWorkerState = "loading";
  #watch: boolean;
  #worker: DectylWorker;

  #handleError(evt: ErrorEvent) {
    logger.error(
      `[${this.name}] ${evt.message}\n  at ${evt.filename}:${evt.lineno}:${evt.colno}`,
    );
  }

  async #handleFetch(id: number, init: FetchMessageRequestInit) {
    if (this.#fetchHandler) {
      const requestEvent = new RequestEvent(this.#worker, id, init);
      this.#pendingRequests.set(id, requestEvent);
      await this.#fetchHandler(requestEvent);
      await requestEvent.finalize();
      this.#pendingRequests.delete(id);
    }
  }

  #handleMessage(evt: MessageEvent<DectylMessage>) {
    const { data } = evt;
    if (data.type !== "internalLog") {
      logger.debug("#handleMessage", data);
    }
    switch (data.type) {
      case "bodyChunk": {
        const { id, chunk, subType } = data;
        if (subType === "response") {
          const bodyController = this.#bodyControllers.get(id);
          assert(bodyController);
          bodyController.enqueue(chunk);
        } else {
          const requestEvent = this.#pendingRequests.get(id);
          assert(requestEvent);
          requestEvent.enqueue(chunk);
        }
        break;
      }
      case "bodyClose": {
        const { id, subType } = data;
        if (subType === "response") {
          const bodyController = this.#bodyControllers.get(id);
          assert(bodyController);
          bodyController.close();
          this.#bodyControllers.delete(id);
        } else {
          const requestEvent = this.#pendingRequests.get(id);
          assert(requestEvent);
          requestEvent.close();
        }
        break;
      }
      case "bodyError": {
        const { id, error, subType } = data;
        if (subType === "response") {
          const bodyController = this.#bodyControllers.get(id);
          assert(bodyController);
          bodyController.error(error);
          this.#bodyControllers.delete(id);
        } else {
          const requestEvent = this.#pendingRequests.get(id);
          assert(requestEvent);
          requestEvent.error(error);
        }
        break;
      }
      case "internalLog": {
        const { level, messages } = data;
        logger.log(level, `[${this.#name}]`, ...messages);
        break;
      }
      case "fetch": {
        const { id, init } = data;
        this.#handleFetch(id, init);
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
      case "respondError": {
        const { id, message, name, stack } = data;
        const error = new Error(message);
        error.name = name;
        error.stack = stack;
        const deferred = this.#pendingFetches.get(id);
        assert(deferred);
        this.#pendingFetches.delete(id);
        deferred.reject(error);
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
    const subType = "request";
    try {
      for await (const chunk of body) {
        if (!(this.#state === "running" || this.#state === "stopped")) {
          this.#worker.postMessage({ type: "bodyClose", id, subType });
          return;
        }
        this.#worker.postMessage({ type: "bodyChunk", id, chunk, subType });
      }
    } catch (error) {
      if (this.#state === "running" || this.#state === "stopped") {
        this.#worker.postMessage({ type: "bodyError", id, error, subType });
      }
    }
    if (this.#state === "running" || this.#state === "stopped") {
      this.#worker.postMessage({ type: "bodyClose", id, subType });
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
    {
      fetchHandler,
      host = "localhost",
      name = createName(),
      watch = false,
      ...options
    }: DeployOptions = {},
  ) {
    logger.debug("DeployWorker.construct", {
      specifier,
      host,
      name,
      watch,
      fetchHandler,
      options,
    });
    this.#fetchHandler = fetchHandler;
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
    this.#worker.addEventListener("error", (evt) => this.#handleError(evt));
    const init = {
      ...options,
      hasFetchHandler: !!fetchHandler,
    };
    this.#worker.postMessage({
      type: "init",
      init,
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

function isTlsOptions(value: ListenOptions): value is Deno.ListenTlsOptions {
  return "certFile" in value && "keyFile" in value;
}
