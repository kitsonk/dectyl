// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

export interface DeployOptions extends DeployWorkerOptions {
  /** The host to use when sending requests into the worker.  Defaults to
   * `localhost`. */
  host?: string;
  /** The name of the deploy worker. If `undefined` a unique name will be
   * generated. */
  name?: string;
  /** If the deploy specifier is a local specifier, watch it, and its
   * dependencies for changes and reload the worker when changed. */
  watch?: boolean;
}

export interface DeployWorkerInfo {
  /** The number of fetches that have been made of the worker. */
  fetchCount: number;
  /** The number of pending fetches that are being processed by the worker. */
  pendingFetches: number;
}

export interface DeployWorkerOptions {
  /** Any environment variables to make available to the Deploy script. */
  env?: Record<string, string>;
}

export type DectylMessage =
  | AbortMessage
  | BodyChunkMessage
  | BodyCloseMessage
  | BodyErrorMessage
  | FetchMessage
  | ImportMessage
  | InitMessage
  | InternalLogMessage
  | LoadedMessage
  | LogMessage
  | ReadyMessage
  | RespondMessage;

export interface DectylMessageBase {
  type: string;
}

interface AbortMessage {
  type: "abort";
  id: number;
}

export interface BodyChunkMessage {
  type: "bodyChunk";
  id: number;
  chunk: Uint8Array;
}

export interface BodyCloseMessage {
  type: "bodyClose";
  id: number;
}

export interface BodyErrorMessage {
  type: "bodyError";
  id: number;
  // deno-lint-ignore no-explicit-any
  error: any;
}

export interface FetchMessageBody {
  type: "cloned" | "urlsearchparams" | "stream" | "null";
  value?: Blob | BufferSource | [string, string][] | string;
}

export interface FetchMessageRequestInit {
  body: FetchMessageBody;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  headers?: [string, string][];
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: number;
  url: string;
}

export interface FetchMessage {
  type: "fetch";
  id: number;
  init: FetchMessageRequestInit;
}

export interface ImportMessage {
  type: "import";
  specifier: string;
}

export interface InitMessage {
  type: "init";
  options: DeployWorkerOptions;
}

export interface InternalLogMessage {
  type: "internalLog";
  level: number;
  messages: string[];
}

export interface LoadedMessage {
  type: "loaded";
}

export interface LogMessage {
  type: "log";
  message: string;
  error: boolean;
}

export interface ReadyMessage {
  type: "ready";
}

export interface RespondMessage {
  type: "respond";
  id: number;
  hasBody: boolean;
  headers: [string, string][];
  status: number;
  statusText: string;
}
