export {};

declare global {
  interface ImportMeta {
    url: string;
    main: boolean;
  }

  namespace Deno {
    export const env: {
      get(key: string): string | undefined;
      set(key: string, value: string): void;
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

    export const noColor: true;

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
