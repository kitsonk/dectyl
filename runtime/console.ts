// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

const INSPECT_OPTIONS = {
  depth: 4,
  indentLevel: 0,
  sorted: false,
  trailingComma: false,
  compact: true,
  iterableLimit: 100,
  showProxy: false,
  colors: false,
  getters: false,
  showHidden: false,
};

export class DectylConsole implements Console {
  #counts = new Map<string, number>();
  #indentLevel = 0;
  #inspect: typeof Deno.inspect;
  #print: (msg: string, error: boolean) => void;
  #timers = new Map<string, number>();

  #inspectArgs(
    args: unknown[],
    inspectOptions: Deno.InspectOptions & { indentLevel?: number } = {},
  ) {
    const rInspectOptions = { ...INSPECT_OPTIONS, ...inspectOptions };
    const first = args[0];
    let a = 0;
    let string = "";

    if (typeof first == "string" && args.length > 1) {
      a++;
      // Index of the first not-yet-appended character. Use this so we only
      // have to append to `string` when a substitution occurs / at the end.
      let appendedChars = 0;
      for (let i = 0; i < first.length - 1; i++) {
        if (first[i] == "%") {
          const char = first[++i];
          if (a < args.length) {
            let formattedArg = null;
            if (char == "s") {
              // Format as a string.
              formattedArg = String(args[a++]);
            } else if (["d", "i"].includes(char)) {
              // Format as an integer.
              const value = args[a++];
              if (typeof value == "bigint") {
                formattedArg = `${value}n`;
              } else if (typeof value == "number") {
                formattedArg = `${parseInt(String(value))}`;
              } else {
                formattedArg = "NaN";
              }
            } else if (char == "f") {
              // Format as a floating point value.
              const value = args[a++];
              if (typeof value == "number") {
                formattedArg = `${value}`;
              } else {
                formattedArg = "NaN";
              }
            } else if (["O", "o"].includes(char)) {
              // Format as an object.
              formattedArg = this.#inspect(
                args[a++],
                rInspectOptions,
              );
            } else if (char == "c") {
              a++;
              formattedArg = "";
            }

            if (formattedArg != null) {
              string += first.slice(appendedChars, i - 1) + formattedArg;
              appendedChars = i + 1;
            }
          }
          if (char == "%") {
            string += first.slice(appendedChars, i - 1) + "%";
            appendedChars = i + 1;
          }
        }
      }
      string += first.slice(appendedChars);
    }

    for (; a < args.length; a++) {
      if (a > 0) {
        string += " ";
      }
      if (typeof args[a] == "string") {
        string += args[a];
      } else {
        // Use default maximum depth for null or undefined arguments.
        string += this.#inspect(args[a], rInspectOptions);
      }
    }

    if (rInspectOptions.indentLevel > 0) {
      const groupIndent = "  ".repeat(rInspectOptions.indentLevel);
      string = groupIndent + string.replaceAll("\n", `\n${groupIndent}`);
    }

    return string;
  }

  constructor(print: (msg: string, error: boolean) => void) {
    this.#print = print;
    this.#inspect = Deno?.inspect.bind(Deno) ??
      function inspect(value) {
        return String(value);
      };
  }

  log(...args: unknown[]) {
    this.#print(
      this.#inspectArgs(args, {
        ...INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      false,
    );
  }

  debug(...args: unknown[]) {
    this.#print(
      this.#inspectArgs(args, {
        ...INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      false,
    );
  }

  info(...args: unknown[]) {
    this.#print(
      this.#inspectArgs(args, {
        ...INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      false,
    );
  }

  dir(obj: unknown, options: Record<string, unknown>) {
    this.#print(
      this.#inspectArgs([obj], {
        ...INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
        ...options,
      }),
      false,
    );
  }

  dirxml(obj: unknown, options: Record<string, unknown>) {
    this.#print(
      this.#inspectArgs([obj], {
        ...INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
        ...options,
      }),
      false,
    );
  }

  warn(...args: unknown[]) {
    this.#print(
      this.#inspectArgs(args, {
        ...INSPECT_OPTIONS,
        indentLevel: this.#indentLevel,
      }),
      true,
    );
  }

  error(...args: unknown[]) {
    this.#print(
      this.#inspectArgs(args, {
        ...INSPECT_OPTIONS,
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
    const message = this.#inspect(args, INSPECT_OPTIONS);
    const err = {
      name: "Trace",
      message,
    } as Error;
    Error.captureStackTrace(err, this.trace);
    this.error(err.stack);
  }
}
