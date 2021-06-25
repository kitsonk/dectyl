// Copyright 2021 the Deno authors. All rights reserved. MIT license.

import { assert } from "../lib/util.ts";

interface ColorCode {
  open: string;
  close: string;
  regexp: RegExp;
}

export interface InspectOptions extends Deno.InspectOptions {
  indentLevel?: number;
}

type CssColor = [number, number, number];

interface Css {
  backgroundColor?: CssColor | null;
  color?: CssColor | null;
  fontWeight?: string | null;
  fontStyle?: string | null;
  textDecorationColor?: CssColor | null;
  textDecorationLine: string[];
}

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

export const customInspect = Symbol.for("Deno.customInspect");

// https://github.com/chalk/ansi-regex/blob/2b56fb0c7a07108e5b54241e8faec160d393aedb/index.js
const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join("|"),
  "g",
);

function code(open: number, close: number): ColorCode {
  return {
    open: `\x1b[${open}m`,
    close: `\x1b[${close}m`,
    regexp: new RegExp(`\\x1b\\[${close}m`, "g"),
  };
}

function run(str: string, code: ColorCode) {
  return `${code.open}${str.replace(code.regexp, code.open)}${code.close}`;
}

const codes = {
  bold: code(1, 22),
  cyan: code(36, 39),
  dim: code(2, 22),
  green: code(32, 39),
  magenta: code(35, 39),
  red: code(31, 39),
  yellow: code(33, 39),
};

const colors = {
  stripColor(str: string) {
    return str.replace(ANSI_PATTERN, "");
  },

  bold: (s: string) => run(s, codes.bold),
  cyan: (s: string) => run(s, codes.cyan),
  dim: (s: string) => run(s, codes.dim),
  green: (s: string) => run(s, codes.green),
  magenta: (s: string) => run(s, codes.magenta),
  red: (s: string) => run(s, codes.red),
  yellow: (s: string) => run(s, codes.yellow),
};

function isInvalidDate(x: Date) {
  return isNaN(x.getTime());
}

function hasOwnProperty(obj: unknown, v: PropertyKey) {
  if (obj == null) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(obj, v);
}

// deno-lint-ignore ban-types
function propertyIsEnumerable(obj: Object, prop: PropertyKey) {
  if (
    obj == null ||
    typeof obj.propertyIsEnumerable !== "function"
  ) {
    return false;
  }

  return obj.propertyIsEnumerable(prop);
}

function isTypedArray(x: unknown): x is TypedArray {
  return ArrayBuffer.isView(x) && !(x instanceof DataView);
}

export const DEFAULT_INSPECT_OPTIONS: InspectOptions = {
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

const DEFAULT_INDENT = "  "; // Default indent string

const LINE_BREAKING_LENGTH = 80;
const MIN_GROUP_LENGTH = 6;
const STR_ABBREVIATE_SIZE = 100;

function getClassInstanceName(instance: unknown) {
  if (typeof instance != "object") {
    return "";
  }
  const constructor = instance?.constructor;
  if (typeof constructor == "function") {
    return constructor.name ?? "";
  }
  return "";
}

function maybeColor(
  fn: (s: string) => string,
  inspectOptions: Deno.InspectOptions,
) {
  return inspectOptions.colors ? fn : (s: string) => s;
}

function inspectFunction(
  // deno-lint-ignore ban-types
  value: Function & { [customInspect]?: () => string },
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  if (customInspect in value && typeof value[customInspect] === "function") {
    return String(value[customInspect]!());
  }
  // Might be Function/AsyncFunction/GeneratorFunction/AsyncGeneratorFunction
  let cstrName = Object.getPrototypeOf(value)?.constructor?.name;
  if (!cstrName) {
    // If prototype is removed or broken,
    // use generic 'Function' instead.
    cstrName = "Function";
  }

  // Our function may have properties, so we want to format those
  // as if our function was an object
  // If we didn't find any properties, we will just append an
  // empty suffix.
  let suffix = ``;
  if (
    Object.keys(value).length > 0 ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    // deno-lint-ignore no-explicit-any
    const propString = inspectRawObject(value as any, level, inspectOptions);
    // Filter out the empty string for the case we only have
    // non-enumerable symbols.
    if (
      propString.length > 0 &&
      propString !== "{}"
    ) {
      suffix = ` ${propString}`;
    }
  }

  if (value.name && value.name !== "anonymous") {
    // from MDN spec
    return cyan(`[${cstrName}: ${value.name}]`) + suffix;
  }
  return cyan(`[${cstrName}]`) + suffix;
}

function inspectIterable(
  value: {
    entries(): IterableIterator<[unknown, unknown]>;
  },
  level: number,
  options: IterableInspectOptions,
  inspectOptions: Deno.InspectOptions,
) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  if (level >= (inspectOptions.depth ?? 0)) {
    return cyan(`[${options.typeName}]`);
  }

  const entries = [];

  const iter = value.entries();
  let entriesLength = 0;
  const next = () => {
    return iter.next();
  };
  for (const el of iter) {
    if (entriesLength < (inspectOptions.iterableLimit ?? 0)) {
      entries.push(
        options.entryHandler(
          el,
          level + 1,
          inspectOptions,
          next.bind(iter),
        ),
      );
    }
    entriesLength++;
  }

  if (options.sort) {
    entries.sort();
  }

  if (entriesLength > (inspectOptions.iterableLimit ?? 0)) {
    const nmore = entriesLength - (inspectOptions.iterableLimit ?? 0);
    entries.push(`... ${nmore} more items`);
  }

  const iPrefix = `${options.displayName ? options.displayName + " " : ""}`;

  const initIndentation = `\n${DEFAULT_INDENT.repeat(level + 1)}`;
  const entryIndentation = `,\n${DEFAULT_INDENT.repeat(level + 1)}`;
  const closingIndentation = `${inspectOptions.trailingComma ? "," : ""}\n${
    DEFAULT_INDENT.repeat(level)
  }`;

  let iContent;
  if (options.group && entries.length > MIN_GROUP_LENGTH) {
    const groups = groupEntries(entries, level, value);
    iContent = `${initIndentation}${
      groups.join(entryIndentation)
    }${closingIndentation}`;
  } else {
    iContent = entries.length === 0 ? "" : ` ${entries.join(", ")} `;
    if (
      colors.stripColor(iContent).length > LINE_BREAKING_LENGTH ||
      !inspectOptions.compact
    ) {
      iContent = `${initIndentation}${
        entries.join(entryIndentation)
      }${closingIndentation}`;
    }
  }

  return `${iPrefix}${options.delims[0]}${iContent}${options.delims[1]}`;
}

// Ported from Node.js
// Copyright Node.js contributors. All rights reserved.
function groupEntries(
  entries: string[],
  level: number,
  value: unknown,
  iterableLimit = 100,
) {
  let totalLength = 0;
  let maxLength = 0;
  let entriesLength = entries.length;
  if (iterableLimit < entriesLength) {
    // This makes sure the "... n more items" part is not taken into account.
    entriesLength--;
  }
  const separatorSpace = 2; // Add 1 for the space and 1 for the separator.
  const dataLen = new Array(entriesLength);
  // Calculate the total length of all output entries and the individual max
  // entries length of all output entries.
  // IN PROGRESS: Colors are being taken into account.
  for (let i = 0; i < entriesLength; i++) {
    // Taking colors into account: removing the ANSI color
    // codes from the string before measuring its length
    const len = colors.stripColor(entries[i]).length;
    dataLen[i] = len;
    totalLength += len + separatorSpace;
    if (maxLength < len) maxLength = len;
  }
  // Add two to `maxLength` as we add a single whitespace character plus a comma
  // in-between two entries.
  const actualMax = maxLength + separatorSpace;
  // Check if at least three entries fit next to each other and prevent grouping
  // of arrays that contains entries of very different length (i.e., if a single
  // entry is longer than 1/5 of all other entries combined). Otherwise the
  // space in-between small entries would be enormous.
  if (
    actualMax * 3 + (level + 1) < LINE_BREAKING_LENGTH &&
    (totalLength / actualMax > 5 || maxLength <= 6)
  ) {
    const approxCharHeights = 2.5;
    const averageBias = Math.sqrt(actualMax - totalLength / entries.length);
    const biasedMax = Math.max(actualMax - 3 - averageBias, 1);
    // Dynamically check how many columns seem possible.
    const columns = Math.min(
      // Ideally a square should be drawn. We expect a character to be about 2.5
      // times as high as wide. This is the area formula to calculate a square
      // which contains n rectangles of size `actualMax * approxCharHeights`.
      // Divide that by `actualMax` to receive the correct number of columns.
      // The added bias increases the columns for short entries.
      Math.round(
        Math.sqrt(approxCharHeights * biasedMax * entriesLength) / biasedMax,
      ),
      // Do not exceed the breakLength.
      Math.floor((LINE_BREAKING_LENGTH - (level + 1)) / actualMax),
      // Limit the columns to a maximum of fifteen.
      15,
    );
    // Return with the original output if no grouping should happen.
    if (columns <= 1) {
      return entries;
    }
    const tmp = [];
    const maxLineLength = [];
    for (let i = 0; i < columns; i++) {
      let lineMaxLength = 0;
      for (let j = i; j < entries.length; j += columns) {
        if (dataLen[j] > lineMaxLength) lineMaxLength = dataLen[j];
      }
      lineMaxLength += separatorSpace;
      maxLineLength[i] = lineMaxLength;
    }
    let order: "padStart" | "padEnd" = "padStart";
    if (value !== undefined && Array.isArray(value)) {
      for (let i = 0; i < entries.length; i++) {
        if (
          typeof value[i] !== "number" &&
          typeof value[i] !== "bigint"
        ) {
          order = "padEnd";
          break;
        }
      }
    }
    // Each iteration creates a single line of grouped entries.
    for (let i = 0; i < entriesLength; i += columns) {
      // The last lines may contain less entries than columns.
      const max = Math.min(i + columns, entriesLength);
      let str = "";
      let j = i;
      for (; j < max - 1; j++) {
        const lengthOfColorCodes = entries[j].length - dataLen[j];
        const padding = maxLineLength[j - i] + lengthOfColorCodes;
        str += `${entries[j]}, `[order](padding, " ");
      }
      if (order === "padStart") {
        const lengthOfColorCodes = entries[j].length - dataLen[j];
        const padding = maxLineLength[j - i] +
          lengthOfColorCodes -
          separatorSpace;
        str += entries[j].padStart(padding, " ");
      } else {
        str += entries[j];
      }
      tmp.push(str);
    }
    if (iterableLimit < entries.length) {
      tmp.push(entries[entriesLength]);
    }
    entries = tmp;
  }
  return entries;
}

function _inspectValue(
  value: unknown,
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  // const proxyDetails = core.getProxyDetails(value);
  // if (proxyDetails != null) {
  //   return inspectOptions.showProxy
  //     ? inspectProxy(proxyDetails, level, inspectOptions)
  //     : inspectValue(proxyDetails[0], level, inspectOptions);
  // }

  const green = maybeColor(colors.green, inspectOptions);
  const yellow = maybeColor(colors.yellow, inspectOptions);
  const dim = maybeColor(colors.dim, inspectOptions);
  const cyan = maybeColor(colors.cyan, inspectOptions);
  const bold = maybeColor(colors.bold, inspectOptions);
  const red = maybeColor(colors.red, inspectOptions);

  switch (typeof value) {
    case "string":
      return green(quoteString(value));
    case "number": // Numbers are yellow
      // Special handling of -0
      return yellow(Object.is(value, -0) ? "-0" : `${value}`);
    case "boolean": // booleans are yellow
      return yellow(String(value));
    case "undefined": // undefined is dim
      return dim(String(value));
    case "symbol": // Symbols are green
      return green(maybeQuoteSymbol(value));
    case "bigint": // Bigints are yellow
      return yellow(`${value}n`);
    case "function": // Function string is cyan
      if (ctxHas(value)) {
        // Circular string is cyan
        return cyan("[Circular]");
      }

      return inspectFunction(value, level, inspectOptions);
    case "object": // null is bold
      if (value === null) {
        return bold("null");
      }

      if (ctxHas(value)) {
        // Circular string is cyan
        return cyan("[Circular]");
      }
      return inspectObject(value, level, inspectOptions);
    default:
      // Not implemented is red
      return red("[Not Implemented]");
  }
}

function inspectValue(
  value: unknown,
  level: number,
  inspectOptions: InspectOptions,
) {
  CTX_STACK.push(value);
  let x;
  try {
    x = _inspectValue(value, level, inspectOptions);
  } finally {
    CTX_STACK.pop();
  }
  return x;
}

// We can match Node's quoting behavior exactly by swapping the double quote and
// single quote in this array. That would give preference to single quotes.
// However, we prefer double quotes as the default.
const QUOTES = ['"', "'", "`"];

/** Surround the string in quotes.
 *
 * The quote symbol is chosen by taking the first of the `QUOTES` array which
 * does not occur in the string. If they all occur, settle with `QUOTES[0]`.
 *
 * Insert a backslash before any occurrence of the chosen quote symbol and
 * before any backslash.
 */
function quoteString(string: string) {
  const quote = QUOTES.find((c) => !string.includes(c)) ?? QUOTES[0];
  const escapePattern = new RegExp(`(?=[${quote}\\\\])`, "g");
  string = string.replace(escapePattern, "\\");
  string = replaceEscapeSequences(string);
  return `${quote}${string}${quote}`;
}

// Replace escape sequences that can modify output.
function replaceEscapeSequences(string: string) {
  return string
    .replace(/[\b]/g, "\\b")
    .replace(/\f/g, "\\f")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\v/g, "\\v")
    .replace(
      // deno-lint-ignore no-control-regex
      /[\x00-\x1f\x7f-\x9f]/g,
      (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"),
    );
}

// Surround a string with quotes when it is required (e.g the string not a valid identifier).
function maybeQuoteString(string: string) {
  if (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(string)) {
    return replaceEscapeSequences(string);
  }

  return quoteString(string);
}

// Surround a symbol's description in quotes when it is required (e.g the description has non printable characters).
function maybeQuoteSymbol(symbol: symbol) {
  if (symbol.description === undefined) {
    return symbol.toString();
  }

  if (/^[a-zA-Z_][a-zA-Z_.0-9]*$/.test(symbol.description)) {
    return symbol.toString();
  }

  return `Symbol(${quoteString(symbol.description)})`;
}

const CTX_STACK: unknown[] = [];

function ctxHas(x: unknown) {
  // Only check parent contexts
  return CTX_STACK.slice(0, CTX_STACK.length - 1).includes(x);
}

// Print strings when they are inside of arrays or objects with quotes
function inspectValueWithQuotes(
  value: unknown,
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const green = maybeColor(colors.green, inspectOptions);
  switch (typeof value) {
    case "string": {
      const trunc = value.length > STR_ABBREVIATE_SIZE
        ? value.slice(0, STR_ABBREVIATE_SIZE) + "..."
        : value;
      return green(quoteString(trunc)); // Quoted strings are green
    }
    default:
      return inspectValue(value, level, inspectOptions);
  }
}

function inspectArray(
  value: unknown[],
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const dim = maybeColor(colors.dim, inspectOptions);
  const options: IterableInspectOptions = {
    typeName: "Array",
    displayName: "",
    delims: ["[", "]"],
    entryHandler: (entry, level, inspectOptions, next) => {
      const [index, val] = entry as [number, unknown];
      let i = index;
      if (!hasOwnProperty(value, i)) {
        i++;
        while (!hasOwnProperty(value, i) && i < value.length) {
          next();
          i++;
        }
        const emptyItems = i - index;
        const ending = emptyItems > 1 ? "s" : "";
        return dim(`<${emptyItems} empty item${ending}>`);
      } else {
        return inspectValueWithQuotes(val, level, inspectOptions);
      }
    },
    group: inspectOptions.compact,
    sort: false,
  };
  return inspectIterable(value, level, options, inspectOptions);
}

function inspectTypedArray(
  typedArrayName: string,
  value: TypedArray,
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const valueLength = value.length;
  const options: IterableInspectOptions = {
    typeName: typedArrayName,
    displayName: `${typedArrayName}(${valueLength})`,
    delims: ["[", "]"],
    entryHandler: (entry, level, inspectOptions) => {
      const val = entry[1];
      return inspectValueWithQuotes(val, level + 1, inspectOptions);
    },
    group: inspectOptions.compact,
    sort: false,
  };
  return inspectIterable(value, level, options, inspectOptions);
}

function inspectSet(
  value: Set<unknown>,
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const options: IterableInspectOptions = {
    typeName: "Set",
    displayName: "Set",
    delims: ["{", "}"],
    entryHandler: (entry, level, inspectOptions) => {
      const val = entry[1];
      return inspectValueWithQuotes(val, level + 1, inspectOptions);
    },
    group: false,
    sort: inspectOptions.sorted,
  };
  return inspectIterable(value, level, options, inspectOptions);
}

interface IterableInspectOptions {
  typeName: string;
  displayName: string;
  delims: string[];
  entryHandler: (
    entry: [unknown, unknown],
    level: number,
    inspectOptions: Deno.InspectOptions,
    next: () => IteratorResult<[unknown, unknown]>,
  ) => string;
  group?: boolean;
  sort?: boolean;
}

function inspectMap(
  value: Map<unknown, unknown>,
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const options: IterableInspectOptions = {
    typeName: "Map",
    displayName: "Map",
    delims: ["{", "}"],
    entryHandler: (entry, level, inspectOptions) => {
      const [key, val] = entry;
      return `${
        inspectValueWithQuotes(
          key,
          level + 1,
          inspectOptions,
        )
      } => ${inspectValueWithQuotes(val, level + 1, inspectOptions)}`;
    },
    group: false,
    sort: inspectOptions.sorted,
  };
  return inspectIterable(
    value,
    level,
    options,
    inspectOptions,
  );
}

function inspectWeakSet(inspectOptions: Deno.InspectOptions) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  return `WeakSet { ${cyan("[items unknown]")} }`; // as seen in Node, with cyan color
}

function inspectWeakMap(inspectOptions: Deno.InspectOptions) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  return `WeakMap { ${cyan("[items unknown]")} }`; // as seen in Node, with cyan color
}

function inspectDate(value: Date, inspectOptions: Deno.InspectOptions) {
  // without quotes, ISO format, in magenta like before
  const magenta = maybeColor(colors.magenta, inspectOptions);
  return magenta(isInvalidDate(value) ? "Invalid Date" : value.toISOString());
}

function inspectRegExp(value: RegExp, inspectOptions: Deno.InspectOptions) {
  const red = maybeColor(colors.red, inspectOptions);
  return red(value.toString()); // RegExps are red
}

function inspectStringObject(
  // deno-lint-ignore ban-types
  value: String,
  inspectOptions: Deno.InspectOptions,
) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  return cyan(`[String: "${value.toString()}"]`); // wrappers are in cyan
}

function inspectBooleanObject(
  // deno-lint-ignore ban-types
  value: Boolean,
  inspectOptions: Deno.InspectOptions,
) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  return cyan(`[Boolean: ${value.toString()}]`); // wrappers are in cyan
}

function inspectNumberObject(
  // deno-lint-ignore ban-types
  value: Number,
  inspectOptions: Deno.InspectOptions,
) {
  const cyan = maybeColor(colors.cyan, inspectOptions);
  return cyan(`[Number: ${value.toString()}]`); // wrappers are in cyan
}

function inspectPromise(
  _value: Promise<unknown>,
  _level: number,
  _inspectOptions: Deno.InspectOptions,
) {
  return `Promise { }`;
}

function inspectRawObject(
  value: Record<PropertyKey, unknown> & { [Symbol.toStringTag]?: string },
  level: number,
  inspectOptions: Deno.InspectOptions,
) {
  const cyan = maybeColor(colors.cyan, inspectOptions);

  if (level >= (inspectOptions.depth ?? 0)) {
    return cyan("[Object]"); // wrappers are in cyan
  }

  let baseString;

  let shouldShowDisplayName = false;
  let displayName = value[
    Symbol.toStringTag
  ];
  if (!displayName) {
    displayName = getClassInstanceName(value);
  }
  if (
    displayName && displayName !== "Object" && displayName !== "anonymous"
  ) {
    shouldShowDisplayName = true;
  }

  const entries = [];
  const stringKeys = Object.keys(value);
  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (inspectOptions.sorted) {
    stringKeys.sort();
    symbolKeys.sort((s1, s2) =>
      (s1.description ?? "").localeCompare(s2.description ?? "")
    );
  }

  const red = maybeColor(colors.red, inspectOptions);

  for (const key of stringKeys) {
    if (inspectOptions.getters) {
      let propertyValue;
      let error = null;
      try {
        propertyValue = value[key];
      } catch (error_) {
        error = error_;
      }
      const inspectedValue = error == null
        ? inspectValueWithQuotes(
          propertyValue,
          level + 1,
          inspectOptions,
        )
        : red(`[Thrown ${error.name}: ${error.message}]`);
      entries.push(`${maybeQuoteString(key)}: ${inspectedValue}`);
    } else {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert(descriptor);
      if (descriptor.get !== undefined && descriptor.set !== undefined) {
        entries.push(`${maybeQuoteString(key)}: [Getter/Setter]`);
      } else if (descriptor.get !== undefined) {
        entries.push(`${maybeQuoteString(key)}: [Getter]`);
      } else {
        entries.push(
          `${maybeQuoteString(key)}: ${
            inspectValueWithQuotes(value[key], level + 1, inspectOptions)
          }`,
        );
      }
    }
  }

  for (const key of symbolKeys) {
    if (
      !inspectOptions.showHidden &&
      !propertyIsEnumerable(value, key)
    ) {
      continue;
    }

    if (inspectOptions.getters) {
      let propertyValue;
      let error;
      try {
        // deno-lint-ignore no-explicit-any
        propertyValue = value[key as any];
      } catch (error_) {
        error = error_;
      }
      const inspectedValue = error == null
        ? inspectValueWithQuotes(
          propertyValue,
          level + 1,
          inspectOptions,
        )
        : red(`Thrown ${error.name}: ${error.message}`);
      entries.push(`[${maybeQuoteSymbol(key)}]: ${inspectedValue}`);
    } else {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert(descriptor);
      if (descriptor.get !== undefined && descriptor.set !== undefined) {
        entries.push(`[${maybeQuoteSymbol(key)}]: [Getter/Setter]`);
      } else if (descriptor.get !== undefined) {
        entries.push(`[${maybeQuoteSymbol(key)}]: [Getter]`);
      } else {
        entries.push(
          `[${maybeQuoteSymbol(key)}]: ${
            // deno-lint-ignore no-explicit-any
            inspectValueWithQuotes(value[key as any], level + 1, inspectOptions)
          }`,
        );
      }
    }
  }

  // Making sure color codes are ignored when calculating the total length
  const totalLength = entries.length + level +
    colors.stripColor(entries.join("")).length;

  if (entries.length === 0) {
    baseString = "{}";
  } else if (totalLength > LINE_BREAKING_LENGTH || !inspectOptions.compact) {
    const entryIndent = DEFAULT_INDENT.repeat(level + 1);
    const closingIndent = DEFAULT_INDENT.repeat(level);
    baseString = `{\n${entryIndent}${entries.join(`,\n${entryIndent}`)}${
      inspectOptions.trailingComma ? "," : ""
    }\n${closingIndent}}`;
  } else {
    baseString = `{ ${entries.join(", ")} }`;
  }

  if (shouldShowDisplayName) {
    baseString = `${displayName} ${baseString}`;
  }

  return baseString;
}

function inspectObject(
  // deno-lint-ignore no-explicit-any
  value: any,
  level: number,
  inspectOptions: Deno.InspectOptions,
): string {
  if (customInspect in value && typeof value[customInspect] === "function") {
    return String(value[customInspect]());
  }
  if (value instanceof Error) {
    return String(value.stack);
  } else if (Array.isArray(value)) {
    return inspectArray(value, level, inspectOptions);
  } else if (value instanceof Number) {
    return inspectNumberObject(value, inspectOptions);
  } else if (value instanceof Boolean) {
    return inspectBooleanObject(value, inspectOptions);
  } else if (value instanceof String) {
    return inspectStringObject(value, inspectOptions);
  } else if (value instanceof Promise) {
    return inspectPromise(value, level, inspectOptions);
  } else if (value instanceof RegExp) {
    return inspectRegExp(value, inspectOptions);
  } else if (value instanceof Date) {
    return inspectDate(value, inspectOptions);
  } else if (value instanceof Set) {
    return inspectSet(value, level, inspectOptions);
  } else if (value instanceof Map) {
    return inspectMap(value, level, inspectOptions);
  } else if (value instanceof WeakSet) {
    return inspectWeakSet(inspectOptions);
  } else if (value instanceof WeakMap) {
    return inspectWeakMap(inspectOptions);
  } else if (isTypedArray(value)) {
    return inspectTypedArray(
      Object.getPrototypeOf(value).constructor.name,
      value,
      level,
      inspectOptions,
    );
  } else {
    // Otherwise, default object formatting
    return inspectRawObject(value, level, inspectOptions);
  }
}

const colorKeywords = new Map([
  ["black", "#000000"],
  ["silver", "#c0c0c0"],
  ["gray", "#808080"],
  ["white", "#ffffff"],
  ["maroon", "#800000"],
  ["red", "#ff0000"],
  ["purple", "#800080"],
  ["fuchsia", "#ff00ff"],
  ["green", "#008000"],
  ["lime", "#00ff00"],
  ["olive", "#808000"],
  ["yellow", "#ffff00"],
  ["navy", "#000080"],
  ["blue", "#0000ff"],
  ["teal", "#008080"],
  ["aqua", "#00ffff"],
  ["orange", "#ffa500"],
  ["aliceblue", "#f0f8ff"],
  ["antiquewhite", "#faebd7"],
  ["aquamarine", "#7fffd4"],
  ["azure", "#f0ffff"],
  ["beige", "#f5f5dc"],
  ["bisque", "#ffe4c4"],
  ["blanchedalmond", "#ffebcd"],
  ["blueviolet", "#8a2be2"],
  ["brown", "#a52a2a"],
  ["burlywood", "#deb887"],
  ["cadetblue", "#5f9ea0"],
  ["chartreuse", "#7fff00"],
  ["chocolate", "#d2691e"],
  ["coral", "#ff7f50"],
  ["cornflowerblue", "#6495ed"],
  ["cornsilk", "#fff8dc"],
  ["crimson", "#dc143c"],
  ["cyan", "#00ffff"],
  ["darkblue", "#00008b"],
  ["darkcyan", "#008b8b"],
  ["darkgoldenrod", "#b8860b"],
  ["darkgray", "#a9a9a9"],
  ["darkgreen", "#006400"],
  ["darkgrey", "#a9a9a9"],
  ["darkkhaki", "#bdb76b"],
  ["darkmagenta", "#8b008b"],
  ["darkolivegreen", "#556b2f"],
  ["darkorange", "#ff8c00"],
  ["darkorchid", "#9932cc"],
  ["darkred", "#8b0000"],
  ["darksalmon", "#e9967a"],
  ["darkseagreen", "#8fbc8f"],
  ["darkslateblue", "#483d8b"],
  ["darkslategray", "#2f4f4f"],
  ["darkslategrey", "#2f4f4f"],
  ["darkturquoise", "#00ced1"],
  ["darkviolet", "#9400d3"],
  ["deeppink", "#ff1493"],
  ["deepskyblue", "#00bfff"],
  ["dimgray", "#696969"],
  ["dimgrey", "#696969"],
  ["dodgerblue", "#1e90ff"],
  ["firebrick", "#b22222"],
  ["floralwhite", "#fffaf0"],
  ["forestgreen", "#228b22"],
  ["gainsboro", "#dcdcdc"],
  ["ghostwhite", "#f8f8ff"],
  ["gold", "#ffd700"],
  ["goldenrod", "#daa520"],
  ["greenyellow", "#adff2f"],
  ["grey", "#808080"],
  ["honeydew", "#f0fff0"],
  ["hotpink", "#ff69b4"],
  ["indianred", "#cd5c5c"],
  ["indigo", "#4b0082"],
  ["ivory", "#fffff0"],
  ["khaki", "#f0e68c"],
  ["lavender", "#e6e6fa"],
  ["lavenderblush", "#fff0f5"],
  ["lawngreen", "#7cfc00"],
  ["lemonchiffon", "#fffacd"],
  ["lightblue", "#add8e6"],
  ["lightcoral", "#f08080"],
  ["lightcyan", "#e0ffff"],
  ["lightgoldenrodyellow", "#fafad2"],
  ["lightgray", "#d3d3d3"],
  ["lightgreen", "#90ee90"],
  ["lightgrey", "#d3d3d3"],
  ["lightpink", "#ffb6c1"],
  ["lightsalmon", "#ffa07a"],
  ["lightseagreen", "#20b2aa"],
  ["lightskyblue", "#87cefa"],
  ["lightslategray", "#778899"],
  ["lightslategrey", "#778899"],
  ["lightsteelblue", "#b0c4de"],
  ["lightyellow", "#ffffe0"],
  ["limegreen", "#32cd32"],
  ["linen", "#faf0e6"],
  ["magenta", "#ff00ff"],
  ["mediumaquamarine", "#66cdaa"],
  ["mediumblue", "#0000cd"],
  ["mediumorchid", "#ba55d3"],
  ["mediumpurple", "#9370db"],
  ["mediumseagreen", "#3cb371"],
  ["mediumslateblue", "#7b68ee"],
  ["mediumspringgreen", "#00fa9a"],
  ["mediumturquoise", "#48d1cc"],
  ["mediumvioletred", "#c71585"],
  ["midnightblue", "#191970"],
  ["mintcream", "#f5fffa"],
  ["mistyrose", "#ffe4e1"],
  ["moccasin", "#ffe4b5"],
  ["navajowhite", "#ffdead"],
  ["oldlace", "#fdf5e6"],
  ["olivedrab", "#6b8e23"],
  ["orangered", "#ff4500"],
  ["orchid", "#da70d6"],
  ["palegoldenrod", "#eee8aa"],
  ["palegreen", "#98fb98"],
  ["paleturquoise", "#afeeee"],
  ["palevioletred", "#db7093"],
  ["papayawhip", "#ffefd5"],
  ["peachpuff", "#ffdab9"],
  ["peru", "#cd853f"],
  ["pink", "#ffc0cb"],
  ["plum", "#dda0dd"],
  ["powderblue", "#b0e0e6"],
  ["rosybrown", "#bc8f8f"],
  ["royalblue", "#4169e1"],
  ["saddlebrown", "#8b4513"],
  ["salmon", "#fa8072"],
  ["sandybrown", "#f4a460"],
  ["seagreen", "#2e8b57"],
  ["seashell", "#fff5ee"],
  ["sienna", "#a0522d"],
  ["skyblue", "#87ceeb"],
  ["slateblue", "#6a5acd"],
  ["slategray", "#708090"],
  ["slategrey", "#708090"],
  ["snow", "#fffafa"],
  ["springgreen", "#00ff7f"],
  ["steelblue", "#4682b4"],
  ["tan", "#d2b48c"],
  ["thistle", "#d8bfd8"],
  ["tomato", "#ff6347"],
  ["turquoise", "#40e0d0"],
  ["violet", "#ee82ee"],
  ["wheat", "#f5deb3"],
  ["whitesmoke", "#f5f5f5"],
  ["yellowgreen", "#9acd32"],
  ["rebeccapurple", "#663399"],
]);

function parseCssColor(colorString: string): [number, number, number] | null {
  if (colorKeywords.has(colorString)) {
    colorString = colorKeywords.get(colorString)!;
  }
  // deno-fmt-ignore
  const hashMatch = colorString.match(/^#([\dA-Fa-f]{2})([\dA-Fa-f]{2})([\dA-Fa-f]{2})([\dA-Fa-f]{2})?$/);
  if (hashMatch != null) {
    return [
      Number(`0x${hashMatch[1]}`),
      Number(`0x${hashMatch[2]}`),
      Number(`0x${hashMatch[3]}`),
    ];
  }
  // deno-fmt-ignore
  const smallHashMatch = colorString.match(/^#([\dA-Fa-f])([\dA-Fa-f])([\dA-Fa-f])([\dA-Fa-f])?$/);
  if (smallHashMatch != null) {
    return [
      Number(`0x${smallHashMatch[1]}0`),
      Number(`0x${smallHashMatch[2]}0`),
      Number(`0x${smallHashMatch[3]}0`),
    ];
  }
  // deno-fmt-ignore
  const rgbMatch = colorString.match(/^rgba?\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*(,\s*([+\-]?\d*\.?\d+)\s*)?\)$/);
  if (rgbMatch != null) {
    return [
      Math.round(Math.max(0, Math.min(255, Number(rgbMatch[1])))),
      Math.round(Math.max(0, Math.min(255, Number(rgbMatch[2])))),
      Math.round(Math.max(0, Math.min(255, Number(rgbMatch[3])))),
    ];
  }
  // deno-fmt-ignore
  const hslMatch = colorString.match(/^hsla?\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)%\s*,\s*([+\-]?\d*\.?\d+)%\s*(,\s*([+\-]?\d*\.?\d+)\s*)?\)$/);
  if (hslMatch != null) {
    // https://www.rapidtables.com/convert/color/hsl-to-rgb.html
    let h = Number(hslMatch[1]) % 360;
    if (h < 0) {
      h += 360;
    }
    const s = Math.max(0, Math.min(100, Number(hslMatch[2]))) / 100;
    const l = Math.max(0, Math.min(100, Number(hslMatch[3]))) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r_;
    let g_;
    let b_;
    if (h < 60) {
      [r_, g_, b_] = [c, x, 0];
    } else if (h < 120) {
      [r_, g_, b_] = [x, c, 0];
    } else if (h < 180) {
      [r_, g_, b_] = [0, c, x];
    } else if (h < 240) {
      [r_, g_, b_] = [0, x, c];
    } else if (h < 300) {
      [r_, g_, b_] = [x, 0, c];
    } else {
      [r_, g_, b_] = [c, 0, x];
    }
    return [
      Math.round((r_ + m) * 255),
      Math.round((g_ + m) * 255),
      Math.round((b_ + m) * 255),
    ];
  }
  return null;
}

function getDefaultCss(): Css {
  return {
    backgroundColor: null,
    color: null,
    fontWeight: null,
    fontStyle: null,
    textDecorationColor: null,
    textDecorationLine: [],
  };
}

function parseCss(cssString: string) {
  const css = getDefaultCss();

  const rawEntries: [string, string][] = [];
  let inValue = false;
  let currentKey: string | null = null;
  let parenthesesDepth = 0;
  let currentPart = "";
  for (let i = 0; i < cssString.length; i++) {
    const c = cssString[i];
    if (c == "(") {
      parenthesesDepth++;
    } else if (parenthesesDepth > 0) {
      if (c == ")") {
        parenthesesDepth--;
      }
    } else if (inValue) {
      if (c == ";") {
        const value = currentPart.trim();
        if (value != "") {
          assert(currentKey);
          rawEntries.push([currentKey, value]);
        }
        currentKey = null;
        currentPart = "";
        inValue = false;
        continue;
      }
    } else if (c == ":") {
      currentKey = currentPart.trim();
      currentPart = "";
      inValue = true;
      continue;
    }
    currentPart += c;
  }
  if (inValue && parenthesesDepth == 0) {
    const value = currentPart.trim();
    if (value != "") {
      assert(currentKey);
      rawEntries.push([currentKey, value]);
    }
    currentKey = null;
    currentPart = "";
  }

  for (const [key, value] of rawEntries) {
    if (key == "background-color") {
      const color = parseCssColor(value);
      if (color != null) {
        css.backgroundColor = color;
      }
    } else if (key == "color") {
      const color = parseCssColor(value);
      if (color != null) {
        css.color = color;
      }
    } else if (key == "font-weight") {
      if (value == "bold") {
        css.fontWeight = value;
      }
    } else if (key == "font-style") {
      if (["italic", "oblique", "oblique 14deg"].includes(value)) {
        css.fontStyle = "italic";
      }
    } else if (key == "text-decoration-line") {
      css.textDecorationLine = [];
      for (const lineType of value.split(/\s+/g)) {
        if (["line-through", "overline", "underline"].includes(lineType)) {
          css.textDecorationLine.push(lineType);
        }
      }
    } else if (key == "text-decoration-color") {
      const color = parseCssColor(value);
      if (color != null) {
        css.textDecorationColor = color;
      }
    } else if (key == "text-decoration") {
      css.textDecorationColor = null;
      css.textDecorationLine = [];
      for (const arg of value.split(/\s+/g)) {
        const maybeColor = parseCssColor(arg);
        if (maybeColor != null) {
          css.textDecorationColor = maybeColor;
        } else if (["line-through", "overline", "underline"].includes(arg)) {
          css.textDecorationLine.push(arg);
        }
      }
    }
  }

  return css;
}

function colorEquals(color1?: CssColor | null, color2?: CssColor | null) {
  return color1?.[0] == color2?.[0] && color1?.[1] == color2?.[1] &&
    color1?.[2] == color2?.[2];
}

function cssToAnsi(css: Css, prevCss: Css | null = null) {
  prevCss = prevCss ?? getDefaultCss();
  let ansi = "";
  if (!colorEquals(css.backgroundColor, prevCss.backgroundColor)) {
    if (css.backgroundColor != null) {
      const [r, g, b] = css.backgroundColor;
      ansi += `\x1b[48;2;${r};${g};${b}m`;
    } else {
      ansi += "\x1b[49m";
    }
  }
  if (!colorEquals(css.color, prevCss.color)) {
    if (css.color != null) {
      const [r, g, b] = css.color;
      ansi += `\x1b[38;2;${r};${g};${b}m`;
    } else {
      ansi += "\x1b[39m";
    }
  }
  if (css.fontWeight != prevCss.fontWeight) {
    if (css.fontWeight == "bold") {
      ansi += `\x1b[1m`;
    } else {
      ansi += "\x1b[22m";
    }
  }
  if (css.fontStyle != prevCss.fontStyle) {
    if (css.fontStyle == "italic") {
      ansi += `\x1b[3m`;
    } else {
      ansi += "\x1b[23m";
    }
  }
  if (!colorEquals(css.textDecorationColor, prevCss.textDecorationColor)) {
    if (css.textDecorationColor != null) {
      const [r, g, b] = css.textDecorationColor;
      ansi += `\x1b[58;2;${r};${g};${b}m`;
    } else {
      ansi += "\x1b[59m";
    }
  }
  if (
    css.textDecorationLine.includes("line-through") !=
      prevCss.textDecorationLine.includes("line-through")
  ) {
    if (css.textDecorationLine.includes("line-through")) {
      ansi += "\x1b[9m";
    } else {
      ansi += "\x1b[29m";
    }
  }
  if (
    css.textDecorationLine.includes("overline") !=
      prevCss.textDecorationLine.includes("overline")
  ) {
    if (css.textDecorationLine.includes("overline")) {
      ansi += "\x1b[53m";
    } else {
      ansi += "\x1b[55m";
    }
  }
  if (
    css.textDecorationLine.includes("underline") !=
      prevCss.textDecorationLine.includes("underline")
  ) {
    if (css.textDecorationLine.includes("underline")) {
      ansi += "\x1b[4m";
    } else {
      ansi += "\x1b[24m";
    }
  }
  return ansi;
}

export function inspectArgs(
  args: unknown[],
  inspectOptions: InspectOptions = {},
) {
  const noColor = globalThis.Deno?.noColor ?? true;
  const rInspectOptions = { ...DEFAULT_INSPECT_OPTIONS, ...inspectOptions };
  const first = args[0];
  let a = 0;
  let string = "";

  if (typeof first == "string" && args.length > 1) {
    a++;
    // Index of the first not-yet-appended character. Use this so we only
    // have to append to `string` when a substitution occurs / at the end.
    let appendedChars = 0;
    let usedStyle = false;
    let prevCss: Css | null = null;
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
            formattedArg = inspectValue(
              args[a++],
              0,
              rInspectOptions,
            );
          } else if (char == "c") {
            const value = args[a++] as string;
            if (!noColor) {
              const css = parseCss(value);
              formattedArg = cssToAnsi(css, prevCss);
              if (formattedArg != "") {
                usedStyle = true;
                prevCss = css;
              }
            } else {
              formattedArg = "";
            }
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
    if (usedStyle) {
      string += "\x1b[0m";
    }
  }

  for (; a < args.length; a++) {
    if (a > 0) {
      string += " ";
    }
    if (typeof args[a] == "string") {
      string += args[a];
    } else {
      // Use default maximum depth for null or undefined arguments.
      string += inspectValue(args[a], 0, rInspectOptions);
    }
  }

  assert(rInspectOptions.indentLevel != null);
  if (rInspectOptions.indentLevel > 0) {
    const groupIndent = DEFAULT_INDENT.repeat(rInspectOptions.indentLevel);
    string = groupIndent + string.replaceAll("\n", `\n${groupIndent}`);
  }

  return string;
}

export function inspect(
  value: unknown,
  inspectOptions: Deno.InspectOptions = {},
) {
  return inspectValue(value, 0, {
    ...DEFAULT_INSPECT_OPTIONS,
    ...inspectOptions,
    indentLevel: 0,
  });
}
