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

    export function readTextFile(path: URL | string): Promise<string>;

    export function readFile(path: URL | string): Promise<Uint8Array>;

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
  }
}
