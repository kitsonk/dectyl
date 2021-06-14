// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

import { DEFAULT_INSPECT_OPTIONS, inspectArgs } from "./inspect.ts";

export class DectylConsole implements Console {
  #counts = new Map<string, number>();
  #indentLevel = 0;
  #print: (msg: string, error: boolean) => void;
  #timers = new Map<string, number>();

  constructor(print: (msg: string, error: boolean) => void) {
    this.#print = print;
  }

  log(...args: unknown[]) {
    this.#print(
      inspectArgs(args, {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      false,
    );
  }

  debug(...args: unknown[]) {
    this.#print(
      inspectArgs(args, {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      false,
    );
  }

  info(...args: unknown[]) {
    this.#print(
      inspectArgs(args, {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      false,
    );
  }

  dir(obj: unknown, options: Record<string, unknown>) {
    this.#print(
      inspectArgs([obj], {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
        ...options,
      }),
      false,
    );
  }

  dirxml(obj: unknown, options: Record<string, unknown>) {
    this.#print(
      inspectArgs([obj], {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
        ...options,
      }),
      false,
    );
  }

  warn(...args: unknown[]) {
    this.#print(
      inspectArgs(args, {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      true,
    );
  }

  error(...args: unknown[]) {
    this.#print(
      inspectArgs(args, {
        ...DEFAULT_INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      true,
    );
  }

  assert(condition: unknown, ...args: unknown[]) {
    if (condition) {
      return;
    }

    if (args.length === 0) {
      this.error("Assertion failed");
      return;
    }

    const [first, ...rest] = args;

    if (typeof first === "string") {
      this.error(`Assertion failed: ${first}`, ...rest);
      return;
    }

    this.error(`Assertion failed:`, ...args);
  }

  count(label = "default") {
    label = String(label);

    if (this.#counts.has(label)) {
      const current = this.#counts.get(label) ?? 0;
      this.#counts.set(label, current + 1);
    } else {
      this.#counts.set(label, 1);
    }

    this.info(`${label}: ${this.#counts.get(label)}`);
  }

  countReset(label = "default") {
    label = String(label);

    if (this.#counts.has(label)) {
      this.#counts.set(label, 0);
    } else {
      this.warn(`Count for "${label}" does not exist`);
    }
  }

  table(data: unknown) {
    this.log(data);
  }

  time(label = "default") {
    label = String(label);

    if (this.#timers.has(label)) {
      this.warn(`Timer "${label}" already exits`);
      return;
    }

    this.#timers.set(label, Date.now());
  }

  timeLog(label = "default", ...args: unknown[]) {
    label = String(label);

    if (!this.#timers.has(label)) {
      this.warn(`Timer "${label}" does not exist`);
      return;
    }

    const startTime = this.#timers.get(label)!;
    const duration = Date.now() - startTime;

    this.info(`${label}: ${duration}ms`, ...args);
  }

  timeEnd(label = "default") {
    label = String(label);

    if (!this.#timers.has(label)) {
      this.warn(`Timer "${label}" does not exist`);
    }

    const startTime = this.#timers.get(label)!;
    this.#timers.delete(label);
    const duration = Date.now() - startTime;

    this.info(`${label}: ${duration}ms`);
  }

  group(...label: unknown[]) {
    if (label.length) {
      this.log(...label);
    }
    this.#indentLevel += 2;
  }

  groupCollapsed(...label: unknown[]) {
    if (label.length) {
      this.log(...label);
    }
    this.#indentLevel += 2;
  }

  groupEnd() {
    if (this.#indentLevel) {
      this.#indentLevel -= 2;
    }
  }

  clear() {
    this.#indentLevel = 0;
  }

  trace(...args: unknown[]) {
    const message = inspectArgs(args, DEFAULT_INSPECT_OPTIONS);
    const err = {
      name: "Trace",
      message,
    } as Error;
    Error.captureStackTrace(err, this.trace);
    this.error(err.stack);
  }
}
