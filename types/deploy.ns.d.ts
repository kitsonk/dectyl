// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

export {};

declare global {
  interface ImportMeta {
    url: string;
    main: boolean;
  }

  namespace Deno {
    export const env: {
      get(key: string): string | undefined;
      /** Deploy does not support setting of environment variables during a
       * session currently. Calling this method will throw a type error. */
      set(key: string, value: string): void;
      /** Deploy does not support deleting of environment variables during a
       * session currently. Calling this method will throw a type error. */
      delete(key: string): void;
      toObject(): Record<string, string>;
    };

    export const build: {
      target: string;
      arch: "x86_64";
      os: "darwin" | "linux" | "windows";
      vendor: string;
      env?: string;
    };

    export const customInspect: unique symbol;

    export const noColor: false;

    export interface InspectOptions {
      colors?: boolean;
      compact?: boolean;
      depth?: number;
      iterableLimit?: number;
      showProxy?: boolean;
      sorted?: boolean;
      trailingComma?: boolean;
      getters?: boolean;
      showHidden?: boolean;
    }

    export function inspect(value: unknown, options?: InspectOptions): string;

    export interface Conn {
      readonly localAddr: Addr;
      readonly remoteAddr: Addr;
      readonly rid: number;

      close(): void;
      closeWrite(): Promise<void>;
      read(p: Uint8Array): Promise<number | null>;
      write(p: Uint8Array): Promise<number>;
    }

    export interface HttpConn extends AsyncIterable<RequestEvent> {
      readonly rid: number;

      nextRequest(): Promise<RequestEvent | null>;
      close(): void;
    }

    export interface Listener extends AsyncIterable<Conn> {
      readonly addr: Addr;
      readonly rid: number;
      accept(): Promise<Conn>;
      close(): void;
      [Symbol.asyncIterator](): AsyncIterableIterator<Conn>;
    }

    export interface RequestEvent {
      readonly request: Request;
      respondWith(r: Response | Promise<Response>): Promise<void>;
    }

    export function listen(options: unknown): Listener;
    export function serveHttp(conn: Conn): HttpConn;
  }
}
