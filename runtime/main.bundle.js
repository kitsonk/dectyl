function assert(cond, msg = "Assertion failed") {
    if (!cond) {
        throw new Error(msg);
    }
}
class Deferred {
    #promise;
    #reject;
    #resolve;
    #settled = false;
    #state = "pending";
    #strict;
    get promise() {
        return this.#promise;
    }
    get state() {
        return this.#state;
    }
    constructor(strict = false){
        this.#promise = new Promise((resolve, reject)=>{
            this.#resolve = resolve;
            this.#reject = reject;
        });
        this.#strict = strict;
    }
    reject(reason) {
        if (this.#settled && this.#strict) {
            throw new TypeError("Already settled.");
        }
        this.#reject(reason);
        if (!this.#settled) {
            this.#settled = true;
            this.#state = "rejected";
        }
    }
    resolve(value) {
        if (this.#settled && this.#strict) {
            throw new TypeError("Already settled.");
        }
        this.#resolve(value);
        if (!this.#settled) {
            this.#settled = true;
            this.#state = "resolved";
        }
    }
}
function parseBodyInit(input, requestInit) {
    assert(requestInit.body);
    if (requestInit.body instanceof ReadableStream) {
        return [
            {
                type: "stream"
            },
            requestInit.body,
            undefined
        ];
    }
    if (requestInit.body instanceof URLSearchParams) {
        const value = [
            ...requestInit.body
        ];
        return [
            {
                type: "urlsearchparams",
                value
            },
            undefined,
            undefined
        ];
    }
    if (requestInit.body instanceof FormData) {
        const request = new Request(input, requestInit);
        assert(request.body);
        const headers = [
            ...request.headers
        ];
        return [
            {
                type: "stream"
            },
            request.body,
            headers.length ? headers : undefined, 
        ];
    }
    return [
        {
            type: "cloned",
            value: requestInit.body
        },
        undefined,
        undefined
    ];
}
function parseHeaders(defaultHeaders, headers) {
    const h = new Headers(headers);
    for (const [key, value] of Object.entries(defaultHeaders)){
        if (!h.has(key)) {
            h.set(key, value);
        }
    }
    return [
        ...h
    ];
}
const customInspect = Symbol.for("Deno.customInspect");
const ANSI_PATTERN = new RegExp([
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))", 
].join("|"), "g");
function code(open, close) {
    return {
        open: `\x1b[${open}m`,
        close: `\x1b[${close}m`,
        regexp: new RegExp(`\\x1b\\[${close}m`, "g")
    };
}
function run(str, code1) {
    return `${code1.open}${str.replace(code1.regexp, code1.open)}${code1.close}`;
}
const codes = {
    bold: code(1, 22),
    cyan: code(36, 39),
    dim: code(2, 22),
    green: code(32, 39),
    magenta: code(35, 39),
    red: code(31, 39),
    yellow: code(33, 39)
};
const colors = {
    stripColor (str) {
        return str.replace(ANSI_PATTERN, "");
    },
    bold: (s)=>run(s, codes.bold)
    ,
    cyan: (s)=>run(s, codes.cyan)
    ,
    dim: (s)=>run(s, codes.dim)
    ,
    green: (s)=>run(s, codes.green)
    ,
    magenta: (s)=>run(s, codes.magenta)
    ,
    red: (s)=>run(s, codes.red)
    ,
    yellow: (s)=>run(s, codes.yellow)
};
function isInvalidDate(x) {
    return isNaN(x.getTime());
}
function hasOwnProperty(obj, v) {
    if (obj == null) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(obj, v);
}
function propertyIsEnumerable(obj, prop) {
    if (obj == null || typeof obj.propertyIsEnumerable !== "function") {
        return false;
    }
    return obj.propertyIsEnumerable(prop);
}
function isTypedArray(x) {
    return ArrayBuffer.isView(x) && !(x instanceof DataView);
}
const DEFAULT_INSPECT_OPTIONS = {
    depth: 4,
    indentLevel: 0,
    sorted: false,
    trailingComma: false,
    compact: true,
    iterableLimit: 100,
    showProxy: false,
    colors: false,
    getters: false,
    showHidden: false
};
const DEFAULT_INDENT = "  ";
function getClassInstanceName(instance) {
    if (typeof instance != "object") {
        return "";
    }
    const constructor = instance?.constructor;
    if (typeof constructor == "function") {
        return constructor.name ?? "";
    }
    return "";
}
function maybeColor(fn, inspectOptions) {
    return inspectOptions.colors ? fn : (s)=>s
    ;
}
function inspectFunction(value, level, inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    if (customInspect in value && typeof value[customInspect] === "function") {
        return String(value[customInspect](inspect));
    }
    let cstrName = Object.getPrototypeOf(value)?.constructor?.name;
    if (!cstrName) {
        cstrName = "Function";
    }
    let suffix = ``;
    if (Object.keys(value).length > 0 || Object.getOwnPropertySymbols(value).length > 0) {
        const propString = inspectRawObject(value, level, inspectOptions);
        if (propString.length > 0 && propString !== "{}") {
            suffix = ` ${propString}`;
        }
    }
    if (value.name && value.name !== "anonymous") {
        return cyan(`[${cstrName}: ${value.name}]`) + suffix;
    }
    return cyan(`[${cstrName}]`) + suffix;
}
function inspectIterable(value, level, options, inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    if (level >= (inspectOptions.depth ?? 0)) {
        return cyan(`[${options.typeName}]`);
    }
    const entries = [];
    const iter = value.entries();
    let entriesLength = 0;
    const next = ()=>{
        return iter.next();
    };
    for (const el of iter){
        if (entriesLength < (inspectOptions.iterableLimit ?? 0)) {
            entries.push(options.entryHandler(el, level + 1, inspectOptions, next.bind(iter)));
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
    const closingIndentation = `${inspectOptions.trailingComma ? "," : ""}\n${DEFAULT_INDENT.repeat(level)}`;
    let iContent;
    if (options.group && entries.length > 6) {
        const groups = groupEntries(entries, level, value);
        iContent = `${initIndentation}${groups.join(entryIndentation)}${closingIndentation}`;
    } else {
        iContent = entries.length === 0 ? "" : ` ${entries.join(", ")} `;
        if (colors.stripColor(iContent).length > 80 || !inspectOptions.compact) {
            iContent = `${initIndentation}${entries.join(entryIndentation)}${closingIndentation}`;
        }
    }
    return `${iPrefix}${options.delims[0]}${iContent}${options.delims[1]}`;
}
function groupEntries(entries, level, value, iterableLimit = 100) {
    let totalLength = 0;
    let maxLength = 0;
    let entriesLength = entries.length;
    if (iterableLimit < entriesLength) {
        entriesLength--;
    }
    const separatorSpace = 2;
    const dataLen = new Array(entriesLength);
    for(let i = 0; i < entriesLength; i++){
        const len = colors.stripColor(entries[i]).length;
        dataLen[i] = len;
        totalLength += len + separatorSpace;
        if (maxLength < len) maxLength = len;
    }
    const actualMax = maxLength + 2;
    if (actualMax * 3 + (level + 1) < 80 && (totalLength / actualMax > 5 || maxLength <= 6)) {
        const approxCharHeights = 2.5;
        const averageBias = Math.sqrt(actualMax - totalLength / entries.length);
        const biasedMax = Math.max(actualMax - 3 - averageBias, 1);
        const columns = Math.min(Math.round(Math.sqrt(2.5 * biasedMax * entriesLength) / biasedMax), Math.floor((80 - (level + 1)) / actualMax), 15);
        if (columns <= 1) {
            return entries;
        }
        const tmp = [];
        const maxLineLength = [];
        for(let i1 = 0; i1 < columns; i1++){
            let lineMaxLength = 0;
            for(let j = i1; j < entries.length; j += columns){
                if (dataLen[j] > lineMaxLength) lineMaxLength = dataLen[j];
            }
            lineMaxLength += separatorSpace;
            maxLineLength[i1] = lineMaxLength;
        }
        let order = "padStart";
        if (value !== undefined && Array.isArray(value)) {
            for(let i2 = 0; i2 < entries.length; i2++){
                if (typeof value[i2] !== "number" && typeof value[i2] !== "bigint") {
                    order = "padEnd";
                    break;
                }
            }
        }
        for(let i2 = 0; i2 < entriesLength; i2 += columns){
            const max = Math.min(i2 + columns, entriesLength);
            let str = "";
            let j = i2;
            for(; j < max - 1; j++){
                const lengthOfColorCodes = entries[j].length - dataLen[j];
                const padding = maxLineLength[j - i2] + lengthOfColorCodes;
                str += `${entries[j]}, `[order](padding, " ");
            }
            if (order === "padStart") {
                const lengthOfColorCodes = entries[j].length - dataLen[j];
                const padding = maxLineLength[j - i2] + lengthOfColorCodes - 2;
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
function _inspectValue(value, level, inspectOptions) {
    const green = maybeColor(colors.green, inspectOptions);
    const yellow = maybeColor(colors.yellow, inspectOptions);
    const dim = maybeColor(colors.dim, inspectOptions);
    const cyan = maybeColor(colors.cyan, inspectOptions);
    const bold = maybeColor(colors.bold, inspectOptions);
    const red = maybeColor(colors.red, inspectOptions);
    switch(typeof value){
        case "string":
            return green(quoteString(value));
        case "number":
            return yellow(Object.is(value, -0) ? "-0" : `${value}`);
        case "boolean":
            return yellow(String(value));
        case "undefined":
            return dim(String(value));
        case "symbol":
            return green(maybeQuoteSymbol(value));
        case "bigint":
            return yellow(`${value}n`);
        case "function":
            if (ctxHas(value)) {
                return cyan("[Circular]");
            }
            return inspectFunction(value, level, inspectOptions);
        case "object":
            if (value === null) {
                return bold("null");
            }
            if (ctxHas(value)) {
                return cyan("[Circular]");
            }
            return inspectObject(value, level, inspectOptions);
        default:
            return red("[Not Implemented]");
    }
}
function inspectValue(value, level, inspectOptions) {
    CTX_STACK.push(value);
    let x;
    try {
        x = _inspectValue(value, level, inspectOptions);
    } finally{
        CTX_STACK.pop();
    }
    return x;
}
const QUOTES = [
    '"',
    "'",
    "`"
];
function quoteString(string) {
    const quote = QUOTES.find((c)=>!string.includes(c)
    ) ?? QUOTES[0];
    const escapePattern = new RegExp(`(?=[${quote}\\\\])`, "g");
    string = string.replace(escapePattern, "\\");
    string = replaceEscapeSequences(string);
    return `${quote}${string}${quote}`;
}
function replaceEscapeSequences(string) {
    return string.replace(/[\b]/g, "\\b").replace(/\f/g, "\\f").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\v/g, "\\v").replace(/[\x00-\x1f\x7f-\x9f]/g, (c)=>"\\x" + c.charCodeAt(0).toString(16).padStart(2, "0")
    );
}
function maybeQuoteString(string) {
    if (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(string)) {
        return replaceEscapeSequences(string);
    }
    return quoteString(string);
}
function maybeQuoteSymbol(symbol) {
    if (symbol.description === undefined) {
        return symbol.toString();
    }
    if (/^[a-zA-Z_][a-zA-Z_.0-9]*$/.test(symbol.description)) {
        return symbol.toString();
    }
    return `Symbol(${quoteString(symbol.description)})`;
}
const CTX_STACK = [];
function ctxHas(x) {
    return CTX_STACK.slice(0, CTX_STACK.length - 1).includes(x);
}
function inspectValueWithQuotes(value, level, inspectOptions) {
    const green = maybeColor(colors.green, inspectOptions);
    switch(typeof value){
        case "string":
            {
                const trunc = value.length > 100 ? value.slice(0, 100) + "..." : value;
                return green(quoteString(trunc));
            }
        default:
            return inspectValue(value, level, inspectOptions);
    }
}
function inspectArray(value, level, inspectOptions) {
    const dim = maybeColor(colors.dim, inspectOptions);
    const options = {
        typeName: "Array",
        displayName: "",
        delims: [
            "[",
            "]"
        ],
        entryHandler: (entry, level1, inspectOptions1, next)=>{
            const [index, val] = entry;
            let i = index;
            if (!hasOwnProperty(value, i)) {
                i++;
                while(!hasOwnProperty(value, i) && i < value.length){
                    next();
                    i++;
                }
                const emptyItems = i - index;
                const ending = emptyItems > 1 ? "s" : "";
                return dim(`<${emptyItems} empty item${ending}>`);
            } else {
                return inspectValueWithQuotes(val, level1, inspectOptions1);
            }
        },
        group: inspectOptions.compact,
        sort: false
    };
    return inspectIterable(value, level, options, inspectOptions);
}
function inspectTypedArray(typedArrayName, value, level, inspectOptions) {
    const valueLength = value.length;
    const options = {
        typeName: typedArrayName,
        displayName: `${typedArrayName}(${valueLength})`,
        delims: [
            "[",
            "]"
        ],
        entryHandler: (entry, level1, inspectOptions1)=>{
            const val = entry[1];
            return inspectValueWithQuotes(val, level1 + 1, inspectOptions1);
        },
        group: inspectOptions.compact,
        sort: false
    };
    return inspectIterable(value, level, options, inspectOptions);
}
function inspectSet(value, level, inspectOptions) {
    const options = {
        typeName: "Set",
        displayName: "Set",
        delims: [
            "{",
            "}"
        ],
        entryHandler: (entry, level1, inspectOptions1)=>{
            const val = entry[1];
            return inspectValueWithQuotes(val, level1 + 1, inspectOptions1);
        },
        group: false,
        sort: inspectOptions.sorted
    };
    return inspectIterable(value, level, options, inspectOptions);
}
function inspectMap(value, level, inspectOptions) {
    const options = {
        typeName: "Map",
        displayName: "Map",
        delims: [
            "{",
            "}"
        ],
        entryHandler: (entry, level1, inspectOptions1)=>{
            const [key, val] = entry;
            return `${inspectValueWithQuotes(key, level1 + 1, inspectOptions1)} => ${inspectValueWithQuotes(val, level1 + 1, inspectOptions1)}`;
        },
        group: false,
        sort: inspectOptions.sorted
    };
    return inspectIterable(value, level, options, inspectOptions);
}
function inspectWeakSet(inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    return `WeakSet { ${cyan("[items unknown]")} }`;
}
function inspectWeakMap(inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    return `WeakMap { ${cyan("[items unknown]")} }`;
}
function inspectDate(value, inspectOptions) {
    const magenta = maybeColor(colors.magenta, inspectOptions);
    return magenta(isInvalidDate(value) ? "Invalid Date" : value.toISOString());
}
function inspectRegExp(value, inspectOptions) {
    const red = maybeColor(colors.red, inspectOptions);
    return red(value.toString());
}
function inspectStringObject(value, inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    return cyan(`[String: "${value.toString()}"]`);
}
function inspectBooleanObject(value, inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    return cyan(`[Boolean: ${value.toString()}]`);
}
function inspectNumberObject(value, inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    return cyan(`[Number: ${value.toString()}]`);
}
function inspectPromise(_value, _level, _inspectOptions) {
    return `Promise { }`;
}
function inspectRawObject(value, level, inspectOptions) {
    const cyan = maybeColor(colors.cyan, inspectOptions);
    if (level >= (inspectOptions.depth ?? 0)) {
        return cyan("[Object]");
    }
    let baseString;
    let shouldShowDisplayName = false;
    let displayName = value[Symbol.toStringTag];
    if (!displayName) {
        displayName = getClassInstanceName(value);
    }
    if (displayName && displayName !== "Object" && displayName !== "anonymous") {
        shouldShowDisplayName = true;
    }
    const entries = [];
    const stringKeys = Object.keys(value);
    const symbolKeys = Object.getOwnPropertySymbols(value);
    if (inspectOptions.sorted) {
        stringKeys.sort();
        symbolKeys.sort((s1, s2)=>(s1.description ?? "").localeCompare(s2.description ?? "")
        );
    }
    const red = maybeColor(colors.red, inspectOptions);
    for (const key of stringKeys){
        if (inspectOptions.getters) {
            let propertyValue;
            let error = null;
            try {
                propertyValue = value[key];
            } catch (error_) {
                error = error_;
            }
            const inspectedValue = error == null ? inspectValueWithQuotes(propertyValue, level + 1, inspectOptions) : red(`[Thrown ${error.name}: ${error.message}]`);
            entries.push(`${maybeQuoteString(key)}: ${inspectedValue}`);
        } else {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            assert(descriptor);
            if (descriptor.get !== undefined && descriptor.set !== undefined) {
                entries.push(`${maybeQuoteString(key)}: [Getter/Setter]`);
            } else if (descriptor.get !== undefined) {
                entries.push(`${maybeQuoteString(key)}: [Getter]`);
            } else {
                entries.push(`${maybeQuoteString(key)}: ${inspectValueWithQuotes(value[key], level + 1, inspectOptions)}`);
            }
        }
    }
    for (const key1 of symbolKeys){
        if (!inspectOptions.showHidden && !propertyIsEnumerable(value, key1)) {
            continue;
        }
        if (inspectOptions.getters) {
            let propertyValue;
            let error;
            try {
                propertyValue = value[key1];
            } catch (error_) {
                error = error_;
            }
            const inspectedValue = error == null ? inspectValueWithQuotes(propertyValue, level + 1, inspectOptions) : red(`Thrown ${error.name}: ${error.message}`);
            entries.push(`[${maybeQuoteSymbol(key1)}]: ${inspectedValue}`);
        } else {
            const descriptor = Object.getOwnPropertyDescriptor(value, key1);
            assert(descriptor);
            if (descriptor.get !== undefined && descriptor.set !== undefined) {
                entries.push(`[${maybeQuoteSymbol(key1)}]: [Getter/Setter]`);
            } else if (descriptor.get !== undefined) {
                entries.push(`[${maybeQuoteSymbol(key1)}]: [Getter]`);
            } else {
                entries.push(`[${maybeQuoteSymbol(key1)}]: ${inspectValueWithQuotes(value[key1], level + 1, inspectOptions)}`);
            }
        }
    }
    const totalLength = entries.length + level + colors.stripColor(entries.join("")).length;
    if (entries.length === 0) {
        baseString = "{}";
    } else if (totalLength > 80 || !inspectOptions.compact) {
        const entryIndent = DEFAULT_INDENT.repeat(level + 1);
        const closingIndent = DEFAULT_INDENT.repeat(level);
        baseString = `{\n${entryIndent}${entries.join(`,\n${entryIndent}`)}${inspectOptions.trailingComma ? "," : ""}\n${closingIndent}}`;
    } else {
        baseString = `{ ${entries.join(", ")} }`;
    }
    if (shouldShowDisplayName) {
        baseString = `${displayName} ${baseString}`;
    }
    return baseString;
}
function inspectObject(value, level, inspectOptions) {
    if (customInspect in value && typeof value[customInspect] === "function") {
        return String(value[customInspect](inspect));
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
        return inspectTypedArray(Object.getPrototypeOf(value).constructor.name, value, level, inspectOptions);
    } else {
        return inspectRawObject(value, level, inspectOptions);
    }
}
const colorKeywords = new Map([
    [
        "black",
        "#000000"
    ],
    [
        "silver",
        "#c0c0c0"
    ],
    [
        "gray",
        "#808080"
    ],
    [
        "white",
        "#ffffff"
    ],
    [
        "maroon",
        "#800000"
    ],
    [
        "red",
        "#ff0000"
    ],
    [
        "purple",
        "#800080"
    ],
    [
        "fuchsia",
        "#ff00ff"
    ],
    [
        "green",
        "#008000"
    ],
    [
        "lime",
        "#00ff00"
    ],
    [
        "olive",
        "#808000"
    ],
    [
        "yellow",
        "#ffff00"
    ],
    [
        "navy",
        "#000080"
    ],
    [
        "blue",
        "#0000ff"
    ],
    [
        "teal",
        "#008080"
    ],
    [
        "aqua",
        "#00ffff"
    ],
    [
        "orange",
        "#ffa500"
    ],
    [
        "aliceblue",
        "#f0f8ff"
    ],
    [
        "antiquewhite",
        "#faebd7"
    ],
    [
        "aquamarine",
        "#7fffd4"
    ],
    [
        "azure",
        "#f0ffff"
    ],
    [
        "beige",
        "#f5f5dc"
    ],
    [
        "bisque",
        "#ffe4c4"
    ],
    [
        "blanchedalmond",
        "#ffebcd"
    ],
    [
        "blueviolet",
        "#8a2be2"
    ],
    [
        "brown",
        "#a52a2a"
    ],
    [
        "burlywood",
        "#deb887"
    ],
    [
        "cadetblue",
        "#5f9ea0"
    ],
    [
        "chartreuse",
        "#7fff00"
    ],
    [
        "chocolate",
        "#d2691e"
    ],
    [
        "coral",
        "#ff7f50"
    ],
    [
        "cornflowerblue",
        "#6495ed"
    ],
    [
        "cornsilk",
        "#fff8dc"
    ],
    [
        "crimson",
        "#dc143c"
    ],
    [
        "cyan",
        "#00ffff"
    ],
    [
        "darkblue",
        "#00008b"
    ],
    [
        "darkcyan",
        "#008b8b"
    ],
    [
        "darkgoldenrod",
        "#b8860b"
    ],
    [
        "darkgray",
        "#a9a9a9"
    ],
    [
        "darkgreen",
        "#006400"
    ],
    [
        "darkgrey",
        "#a9a9a9"
    ],
    [
        "darkkhaki",
        "#bdb76b"
    ],
    [
        "darkmagenta",
        "#8b008b"
    ],
    [
        "darkolivegreen",
        "#556b2f"
    ],
    [
        "darkorange",
        "#ff8c00"
    ],
    [
        "darkorchid",
        "#9932cc"
    ],
    [
        "darkred",
        "#8b0000"
    ],
    [
        "darksalmon",
        "#e9967a"
    ],
    [
        "darkseagreen",
        "#8fbc8f"
    ],
    [
        "darkslateblue",
        "#483d8b"
    ],
    [
        "darkslategray",
        "#2f4f4f"
    ],
    [
        "darkslategrey",
        "#2f4f4f"
    ],
    [
        "darkturquoise",
        "#00ced1"
    ],
    [
        "darkviolet",
        "#9400d3"
    ],
    [
        "deeppink",
        "#ff1493"
    ],
    [
        "deepskyblue",
        "#00bfff"
    ],
    [
        "dimgray",
        "#696969"
    ],
    [
        "dimgrey",
        "#696969"
    ],
    [
        "dodgerblue",
        "#1e90ff"
    ],
    [
        "firebrick",
        "#b22222"
    ],
    [
        "floralwhite",
        "#fffaf0"
    ],
    [
        "forestgreen",
        "#228b22"
    ],
    [
        "gainsboro",
        "#dcdcdc"
    ],
    [
        "ghostwhite",
        "#f8f8ff"
    ],
    [
        "gold",
        "#ffd700"
    ],
    [
        "goldenrod",
        "#daa520"
    ],
    [
        "greenyellow",
        "#adff2f"
    ],
    [
        "grey",
        "#808080"
    ],
    [
        "honeydew",
        "#f0fff0"
    ],
    [
        "hotpink",
        "#ff69b4"
    ],
    [
        "indianred",
        "#cd5c5c"
    ],
    [
        "indigo",
        "#4b0082"
    ],
    [
        "ivory",
        "#fffff0"
    ],
    [
        "khaki",
        "#f0e68c"
    ],
    [
        "lavender",
        "#e6e6fa"
    ],
    [
        "lavenderblush",
        "#fff0f5"
    ],
    [
        "lawngreen",
        "#7cfc00"
    ],
    [
        "lemonchiffon",
        "#fffacd"
    ],
    [
        "lightblue",
        "#add8e6"
    ],
    [
        "lightcoral",
        "#f08080"
    ],
    [
        "lightcyan",
        "#e0ffff"
    ],
    [
        "lightgoldenrodyellow",
        "#fafad2"
    ],
    [
        "lightgray",
        "#d3d3d3"
    ],
    [
        "lightgreen",
        "#90ee90"
    ],
    [
        "lightgrey",
        "#d3d3d3"
    ],
    [
        "lightpink",
        "#ffb6c1"
    ],
    [
        "lightsalmon",
        "#ffa07a"
    ],
    [
        "lightseagreen",
        "#20b2aa"
    ],
    [
        "lightskyblue",
        "#87cefa"
    ],
    [
        "lightslategray",
        "#778899"
    ],
    [
        "lightslategrey",
        "#778899"
    ],
    [
        "lightsteelblue",
        "#b0c4de"
    ],
    [
        "lightyellow",
        "#ffffe0"
    ],
    [
        "limegreen",
        "#32cd32"
    ],
    [
        "linen",
        "#faf0e6"
    ],
    [
        "magenta",
        "#ff00ff"
    ],
    [
        "mediumaquamarine",
        "#66cdaa"
    ],
    [
        "mediumblue",
        "#0000cd"
    ],
    [
        "mediumorchid",
        "#ba55d3"
    ],
    [
        "mediumpurple",
        "#9370db"
    ],
    [
        "mediumseagreen",
        "#3cb371"
    ],
    [
        "mediumslateblue",
        "#7b68ee"
    ],
    [
        "mediumspringgreen",
        "#00fa9a"
    ],
    [
        "mediumturquoise",
        "#48d1cc"
    ],
    [
        "mediumvioletred",
        "#c71585"
    ],
    [
        "midnightblue",
        "#191970"
    ],
    [
        "mintcream",
        "#f5fffa"
    ],
    [
        "mistyrose",
        "#ffe4e1"
    ],
    [
        "moccasin",
        "#ffe4b5"
    ],
    [
        "navajowhite",
        "#ffdead"
    ],
    [
        "oldlace",
        "#fdf5e6"
    ],
    [
        "olivedrab",
        "#6b8e23"
    ],
    [
        "orangered",
        "#ff4500"
    ],
    [
        "orchid",
        "#da70d6"
    ],
    [
        "palegoldenrod",
        "#eee8aa"
    ],
    [
        "palegreen",
        "#98fb98"
    ],
    [
        "paleturquoise",
        "#afeeee"
    ],
    [
        "palevioletred",
        "#db7093"
    ],
    [
        "papayawhip",
        "#ffefd5"
    ],
    [
        "peachpuff",
        "#ffdab9"
    ],
    [
        "peru",
        "#cd853f"
    ],
    [
        "pink",
        "#ffc0cb"
    ],
    [
        "plum",
        "#dda0dd"
    ],
    [
        "powderblue",
        "#b0e0e6"
    ],
    [
        "rosybrown",
        "#bc8f8f"
    ],
    [
        "royalblue",
        "#4169e1"
    ],
    [
        "saddlebrown",
        "#8b4513"
    ],
    [
        "salmon",
        "#fa8072"
    ],
    [
        "sandybrown",
        "#f4a460"
    ],
    [
        "seagreen",
        "#2e8b57"
    ],
    [
        "seashell",
        "#fff5ee"
    ],
    [
        "sienna",
        "#a0522d"
    ],
    [
        "skyblue",
        "#87ceeb"
    ],
    [
        "slateblue",
        "#6a5acd"
    ],
    [
        "slategray",
        "#708090"
    ],
    [
        "slategrey",
        "#708090"
    ],
    [
        "snow",
        "#fffafa"
    ],
    [
        "springgreen",
        "#00ff7f"
    ],
    [
        "steelblue",
        "#4682b4"
    ],
    [
        "tan",
        "#d2b48c"
    ],
    [
        "thistle",
        "#d8bfd8"
    ],
    [
        "tomato",
        "#ff6347"
    ],
    [
        "turquoise",
        "#40e0d0"
    ],
    [
        "violet",
        "#ee82ee"
    ],
    [
        "wheat",
        "#f5deb3"
    ],
    [
        "whitesmoke",
        "#f5f5f5"
    ],
    [
        "yellowgreen",
        "#9acd32"
    ],
    [
        "rebeccapurple",
        "#663399"
    ], 
]);
function parseCssColor(colorString) {
    if (colorKeywords.has(colorString)) {
        colorString = colorKeywords.get(colorString);
    }
    const hashMatch = colorString.match(/^#([\dA-Fa-f]{2})([\dA-Fa-f]{2})([\dA-Fa-f]{2})([\dA-Fa-f]{2})?$/);
    if (hashMatch != null) {
        return [
            Number(`0x${hashMatch[1]}`),
            Number(`0x${hashMatch[2]}`),
            Number(`0x${hashMatch[3]}`), 
        ];
    }
    const smallHashMatch = colorString.match(/^#([\dA-Fa-f])([\dA-Fa-f])([\dA-Fa-f])([\dA-Fa-f])?$/);
    if (smallHashMatch != null) {
        return [
            Number(`0x${smallHashMatch[1]}0`),
            Number(`0x${smallHashMatch[2]}0`),
            Number(`0x${smallHashMatch[3]}0`), 
        ];
    }
    const rgbMatch = colorString.match(/^rgba?\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)\s*(,\s*([+\-]?\d*\.?\d+)\s*)?\)$/);
    if (rgbMatch != null) {
        return [
            Math.round(Math.max(0, Math.min(255, Number(rgbMatch[1])))),
            Math.round(Math.max(0, Math.min(255, Number(rgbMatch[2])))),
            Math.round(Math.max(0, Math.min(255, Number(rgbMatch[3])))), 
        ];
    }
    const hslMatch = colorString.match(/^hsla?\(\s*([+\-]?\d*\.?\d+)\s*,\s*([+\-]?\d*\.?\d+)%\s*,\s*([+\-]?\d*\.?\d+)%\s*(,\s*([+\-]?\d*\.?\d+)\s*)?\)$/);
    if (hslMatch != null) {
        let h = Number(hslMatch[1]) % 360;
        if (h < 0) {
            h += 360;
        }
        const s = Math.max(0, Math.min(100, Number(hslMatch[2]))) / 100;
        const l = Math.max(0, Math.min(100, Number(hslMatch[3]))) / 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(h / 60 % 2 - 1));
        const m = l - c / 2;
        let r_;
        let g_;
        let b_;
        if (h < 60) {
            [r_, g_, b_] = [
                c,
                x,
                0
            ];
        } else if (h < 120) {
            [r_, g_, b_] = [
                x,
                c,
                0
            ];
        } else if (h < 180) {
            [r_, g_, b_] = [
                0,
                c,
                x
            ];
        } else if (h < 240) {
            [r_, g_, b_] = [
                0,
                x,
                c
            ];
        } else if (h < 300) {
            [r_, g_, b_] = [
                x,
                0,
                c
            ];
        } else {
            [r_, g_, b_] = [
                c,
                0,
                x
            ];
        }
        return [
            Math.round((r_ + m) * 255),
            Math.round((g_ + m) * 255),
            Math.round((b_ + m) * 255), 
        ];
    }
    return null;
}
function getDefaultCss() {
    return {
        backgroundColor: null,
        color: null,
        fontWeight: null,
        fontStyle: null,
        textDecorationColor: null,
        textDecorationLine: []
    };
}
function parseCss(cssString) {
    const css = getDefaultCss();
    const rawEntries = [];
    let inValue = false;
    let currentKey = null;
    let parenthesesDepth = 0;
    let currentPart = "";
    for(let i = 0; i < cssString.length; i++){
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
                    rawEntries.push([
                        currentKey,
                        value
                    ]);
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
            rawEntries.push([
                currentKey,
                value
            ]);
        }
        currentKey = null;
        currentPart = "";
    }
    for (const [key, value] of rawEntries){
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
            if ([
                "italic",
                "oblique",
                "oblique 14deg"
            ].includes(value)) {
                css.fontStyle = "italic";
            }
        } else if (key == "text-decoration-line") {
            css.textDecorationLine = [];
            for (const lineType of value.split(/\s+/g)){
                if ([
                    "line-through",
                    "overline",
                    "underline"
                ].includes(lineType)) {
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
            for (const arg of value.split(/\s+/g)){
                const maybeColor1 = parseCssColor(arg);
                if (maybeColor1 != null) {
                    css.textDecorationColor = maybeColor1;
                } else if ([
                    "line-through",
                    "overline",
                    "underline"
                ].includes(arg)) {
                    css.textDecorationLine.push(arg);
                }
            }
        }
    }
    return css;
}
function colorEquals(color1, color2) {
    return color1?.[0] == color2?.[0] && color1?.[1] == color2?.[1] && color1?.[2] == color2?.[2];
}
function cssToAnsi(css, prevCss = null) {
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
    if (css.textDecorationLine.includes("line-through") != prevCss.textDecorationLine.includes("line-through")) {
        if (css.textDecorationLine.includes("line-through")) {
            ansi += "\x1b[9m";
        } else {
            ansi += "\x1b[29m";
        }
    }
    if (css.textDecorationLine.includes("overline") != prevCss.textDecorationLine.includes("overline")) {
        if (css.textDecorationLine.includes("overline")) {
            ansi += "\x1b[53m";
        } else {
            ansi += "\x1b[55m";
        }
    }
    if (css.textDecorationLine.includes("underline") != prevCss.textDecorationLine.includes("underline")) {
        if (css.textDecorationLine.includes("underline")) {
            ansi += "\x1b[4m";
        } else {
            ansi += "\x1b[24m";
        }
    }
    return ansi;
}
function inspectArgs(args, inspectOptions = {
}) {
    const noColor = globalThis.Deno?.noColor ?? true;
    const rInspectOptions = {
        ...DEFAULT_INSPECT_OPTIONS,
        ...inspectOptions
    };
    const first = args[0];
    let a = 0;
    let string = "";
    if (typeof first == "string" && args.length > 1) {
        a++;
        let appendedChars = 0;
        let usedStyle = false;
        let prevCss = null;
        for(let i = 0; i < first.length - 1; i++){
            if (first[i] == "%") {
                const __char = first[++i];
                if (a < args.length) {
                    let formattedArg = null;
                    if (__char == "s") {
                        formattedArg = String(args[a++]);
                    } else if ([
                        "d",
                        "i"
                    ].includes(__char)) {
                        const value = args[a++];
                        if (typeof value == "bigint") {
                            formattedArg = `${value}n`;
                        } else if (typeof value == "number") {
                            formattedArg = `${parseInt(String(value))}`;
                        } else {
                            formattedArg = "NaN";
                        }
                    } else if (__char == "f") {
                        const value = args[a++];
                        if (typeof value == "number") {
                            formattedArg = `${value}`;
                        } else {
                            formattedArg = "NaN";
                        }
                    } else if ([
                        "O",
                        "o"
                    ].includes(__char)) {
                        formattedArg = inspectValue(args[a++], 0, rInspectOptions);
                    } else if (__char == "c") {
                        const value = args[a++];
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
                if (__char == "%") {
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
    for(; a < args.length; a++){
        if (a > 0) {
            string += " ";
        }
        if (typeof args[a] == "string") {
            string += args[a];
        } else {
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
function inspect(value, inspectOptions = {
}) {
    return inspectValue(value, 0, {
        ...DEFAULT_INSPECT_OPTIONS,
        ...inspectOptions,
        indentLevel: 0
    });
}
class DectylConsole {
    #counts = new Map();
    #indentLevel = 0;
    #print;
    #timers = new Map();
    constructor(print){
        this.#print = print;
    }
    log(...args) {
        this.#print(inspectArgs(args, {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel
        }), false);
    }
    debug(...args) {
        this.#print(inspectArgs(args, {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel
        }), false);
    }
    info(...args) {
        this.#print(inspectArgs(args, {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel
        }), false);
    }
    dir(obj, options) {
        this.#print(inspectArgs([
            obj
        ], {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel,
            ...options
        }), false);
    }
    dirxml(obj, options) {
        this.#print(inspectArgs([
            obj
        ], {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel,
            ...options
        }), false);
    }
    warn(...args) {
        this.#print(inspectArgs(args, {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel
        }), true);
    }
    error(...args) {
        this.#print(inspectArgs(args, {
            ...DEFAULT_INSPECT_OPTIONS,
            indentLevel: this.#indentLevel
        }), true);
    }
    assert(condition, ...args) {
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
    table(data) {
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
    timeLog(label = "default", ...args) {
        label = String(label);
        if (!this.#timers.has(label)) {
            this.warn(`Timer "${label}" does not exist`);
            return;
        }
        const startTime = this.#timers.get(label);
        const duration = Date.now() - startTime;
        this.info(`${label}: ${duration}ms`, ...args);
    }
    timeEnd(label = "default") {
        label = String(label);
        if (!this.#timers.has(label)) {
            this.warn(`Timer "${label}" does not exist`);
        }
        const startTime = this.#timers.get(label);
        this.#timers.delete(label);
        const duration = Date.now() - startTime;
        this.info(`${label}: ${duration}ms`);
    }
    group(...label) {
        if (label.length) {
            this.log(...label);
        }
        this.#indentLevel += 2;
    }
    groupCollapsed(...label) {
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
    trace(...args) {
        const message = inspectArgs(args, DEFAULT_INSPECT_OPTIONS);
        const err = {
            name: "Trace",
            message
        };
        Error.captureStackTrace(err, this.trace);
        this.error(err.stack);
    }
}
const importMeta = {
    url: "file:///Users/sr/c/github.com/satyarohith/dectyl/runtime/main.ts",
    main: import.meta.main
};
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
];
var LogLevel;
(function(LogLevel1) {
    LogLevel1[LogLevel1["Debug"] = 0] = "Debug";
    LogLevel1[LogLevel1["Info"] = 1] = "Info";
    LogLevel1[LogLevel1["Warn"] = 2] = "Warn";
    LogLevel1[LogLevel1["Error"] = 3] = "Error";
})(LogLevel || (LogLevel = {
}));
class FetchEvent extends Event {
    #request;
    #respondWith;
    #responded = false;
    get request() {
        return this.#request;
    }
    constructor(request, respondWith){
        super("fetch");
        this.#request = request;
        this.#respondWith = respondWith;
    }
    respondWith(response) {
        if (this.#responded === true) {
            throw new TypeError("Already responded to this FetchEvent.");
        } else {
            this.#responded = true;
        }
        this.#respondWith(response).catch((err)=>console.warn(err)
        );
    }
    [Symbol.toStringTag]() {
        return "FetchEvent";
    }
}
Object.assign(globalThis, {
    FetchEvent
});
class DeployDenoNs {
    #env = new Map([
        [
            "DENO_DEPLOYMENT_ID",
            "00000000"
        ]
    ]);
    create() {
        const build = {
            target: "x86_64-unknown-linux-gnu",
            arch: "x86_64",
            os: "linux",
            vendor: "unknown",
            env: "gnu"
        };
        const env = {
            get: (key)=>{
                return this.#env.get(key);
            },
            set: (_key, _value)=>{
                throw new TypeError("Can not modify env vars during execution.");
            },
            delete: (_key)=>{
                throw new TypeError("Can not modify env vars during execution.");
            },
            toObject: ()=>{
                return Object.fromEntries(this.#env);
            }
        };
        async function readTextFile(path) {
            if (!(path instanceof URL)) {
                path = new URL(path, importMeta.url);
            }
            const res = await fetch(path);
            return await res.text();
        }
        async function readFile(path) {
            if (!(path instanceof URL)) {
                path = new URL(path, importMeta.url);
            }
            const res = await fetch(path);
            return new Uint8Array(await res.arrayBuffer());
        }
        return Object.create({
        }, {
            "build": createReadOnly(build),
            "customInspect": createReadOnly(customInspect),
            "env": createReadOnly(env),
            "inspect": createReadOnly(inspect),
            "noColor": createValueDesc(false),
            "readTextFile": createReadOnly(readTextFile),
            "readFile": createReadOnly(readFile)
        });
    }
    setEnv(obj) {
        for (const [key, value] of Object.entries(obj)){
            this.#env.set(key, value);
        }
    }
}
class DeployWorkerHost {
    #bodyControllers = new Map();
    #denoNs;
    #fetch = globalThis.fetch.bind(globalThis);
    #fetchId = 1;
    #hasFetchHandler = false;
    #pendingFetches = new Map();
    #postMessage = globalThis.postMessage.bind(globalThis);
    #responseBodyControllers = new Map();
    #signalControllers = new Map();
    #signalId = 1;
    #target;
    async #handleMessage(evt) {
        const { data  } = evt;
        this.#log(LogLevel.Debug, "#handleMessage", data);
        switch(data.type){
            case "abort":
                {
                    const { id  } = data;
                    const controller = this.#signalControllers.get(id);
                    if (controller) {
                        controller.abort();
                        this.#signalControllers.delete(id);
                    }
                    break;
                }
            case "bodyChunk":
                {
                    const { id , chunk , subType  } = data;
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
            case "bodyClose":
                {
                    const { id , subType  } = data;
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
            case "bodyError":
                {
                    const { id , error , subType  } = data;
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
            case "init":
                {
                    const { env , hasFetchHandler =false  } = data.init;
                    if (env) {
                        this.#denoNs.setEnv(env);
                    }
                    this.#hasFetchHandler = hasFetchHandler;
                    this.#postMessage({
                        type: "ready"
                    });
                    break;
                }
            case "import":
                await import(data.specifier);
                this.#postMessage({
                    type: "loaded"
                });
                break;
            case "fetch":
                {
                    const { id , init  } = data;
                    const [input, requestInit] = this.#parseInit(id, init);
                    this.#target.dispatchEvent(new FetchEvent(new Request(input, requestInit), (response)=>this.#postResponse(id, response)
                    ));
                    break;
                }
            case "respond":
                {
                    const { id , hasBody , type: _ , ...responseInit } = data;
                    let bodyInit = null;
                    if (hasBody) {
                        bodyInit = new ReadableStream({
                            start: (controller)=>{
                                this.#responseBodyControllers.set(id, controller);
                            }
                        });
                    }
                    const response = new Response(bodyInit, responseInit);
                    const deferred = this.#pendingFetches.get(id);
                    assert(deferred);
                    this.#pendingFetches.delete(id);
                    deferred.resolve(response);
                    break;
                }
            case "respondError":
                {
                    const { id , message , name  } = data;
                    const error = new Error(message);
                    error.name = name;
                    const deferred = this.#pendingFetches.get(id);
                    assert(deferred);
                    this.#pendingFetches.delete(id);
                    deferred.reject(error);
                    break;
                }
            default:
                console.error(`error: [${self.name}] Unhandled message type: "${data.type}"`);
        }
    }
     #log(level, ...data) {
        this.#postMessage({
            type: "internalLog",
            level,
            messages: data.map((v)=>typeof v === "string" ? v : inspect(v)
            )
        });
    }
     #parseInit(id, init) {
        const requestInit = {
        };
        switch(init.body.type){
            case "null":
                requestInit.body = null;
                break;
            case "cloned":
                requestInit.body = init.body.value;
                break;
            case "urlsearchparams":
                requestInit.body = new URLSearchParams(init.body.value);
                break;
            case "stream":
                assert(!this.#bodyControllers.has(id));
                requestInit.body = new ReadableStream({
                    start: (controller)=>{
                        this.#bodyControllers.set(id, controller);
                    }
                });
        }
        if (init.signal) {
            assert(!this.#signalControllers.has(id));
            const controller = new AbortController();
            this.#signalControllers.set(id, controller);
            requestInit.signal = controller.signal;
        }
        requestInit.headers = init.headers;
        for (const key of INIT_PROPS){
            requestInit[key] = init[key];
        }
        return [
            init.url,
            requestInit
        ];
    }
    async #postResponse(id, res) {
        let response;
        try {
            response = await res;
        } catch (err) {
            assert(err instanceof Error);
            this.#postMessage({
                type: "respondError",
                id,
                message: err.message,
                name: err.name,
                stack: err.stack
            });
            return;
        }
        const { body , headers , status , statusText  } = response;
        this.#postMessage({
            type: "respond",
            id,
            hasBody: body != null,
            headers: [
                ...headers
            ],
            status,
            statusText
        });
        const subType = "response";
        if (body) {
            try {
                for await (const chunk of body){
                    this.#postMessage({
                        type: "bodyChunk",
                        id,
                        chunk,
                        subType
                    });
                }
            } catch (error) {
                this.#postMessage({
                    type: "bodyError",
                    id,
                    error,
                    subType
                });
            }
            this.#postMessage({
                type: "bodyClose",
                id,
                subType
            });
        }
    }
     #print(message, error) {
        this.#postMessage({
            type: "log",
            message,
            error
        });
    }
    async #streamBody(id, body) {
        const subType = "request";
        try {
            for await (const chunk of body){
                this.#postMessage({
                    type: "bodyChunk",
                    id,
                    chunk,
                    subType
                });
            }
        } catch (error) {
            this.#postMessage({
                type: "bodyError",
                id,
                error,
                subType
            });
        }
        this.#postMessage({
            type: "bodyClose",
            id,
            subType
        });
    }
     #watchSignal(signal) {
        if (!signal) {
            return;
        }
        const id = this.#signalId++;
        signal.addEventListener("abort", ()=>{
            this.#postMessage({
                type: "abort",
                id
            });
        });
        return id;
    }
    constructor(){
        addEventListener("message", (evt)=>{
            this.#handleMessage(evt);
        });
        const console = new DectylConsole(this.#print.bind(this));
        const target = this.#target = new EventTarget();
        const denoNs = this.#denoNs = new DeployDenoNs();
        Object.defineProperties(globalThis, {
            "addEventListener": createValueDesc(target.addEventListener.bind(target)),
            "console": createNonEnumDesc(console),
            "Deno": createReadOnly(denoNs.create()),
            "dispatchEvent": createValueDesc(target.dispatchEvent.bind(target)),
            "fetch": createValueDesc(this.fetch.bind(this)),
            "removeEventListener": createValueDesc(target.removeEventListener.bind(target))
        });
    }
    fetch(input, requestInit) {
        if (!this.#hasFetchHandler) {
            return this.#fetch(input, requestInit);
        }
        this.#log(LogLevel.Debug, "fetch()", {
            input,
            requestInit
        });
        const id = this.#fetchId++;
        const deferred = new Deferred();
        this.#pendingFetches.set(id, deferred);
        const init = {
            body: {
                type: "null"
            },
            url: ""
        };
        let inputRequest;
        let bodyStream;
        let url;
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
        const defaultHeaders = {
            host: url.host,
            "x-forwarded-for": "127.0.0.1"
        };
        if (requestInit && inputRequest) {
            let headers;
            if (requestInit.body != null) {
                [init.body, bodyStream, headers] = parseBodyInit(inputRequest ?? init.url, requestInit);
            } else if (inputRequest.body) {
                bodyStream = inputRequest.body;
                init.body = {
                    type: "stream"
                };
            }
            init.headers = parseHeaders(defaultHeaders, (headers ?? requestInit.headers) ?? inputRequest.headers);
            init.signal = this.#watchSignal(requestInit.signal ?? inputRequest.signal);
            for (const key of INIT_PROPS){
                init[key] = requestInit[key] ?? inputRequest[key];
            }
        } else if (requestInit) {
            let headers;
            if (requestInit.body != null) {
                [init.body, bodyStream, headers] = parseBodyInit(inputRequest ?? init.url, requestInit);
            }
            init.headers = parseHeaders(defaultHeaders, headers ?? requestInit.headers);
            init.signal = this.#watchSignal(requestInit.signal);
            for (const key of INIT_PROPS){
                init[key] = requestInit[key];
            }
        } else if (inputRequest) {
            if (inputRequest.body) {
                bodyStream = inputRequest.body;
                init.body = {
                    type: "stream"
                };
            }
            init.headers = parseHeaders(defaultHeaders, inputRequest.headers);
            init.signal = this.#watchSignal(inputRequest.signal);
            for (const key of INIT_PROPS){
                init[key] = inputRequest[key];
            }
        } else {
            init.headers = parseHeaders(defaultHeaders);
        }
        this.#postMessage({
            type: "fetch",
            id,
            init
        });
        if (bodyStream) {
            this.#streamBody(id, bodyStream);
        }
        return deferred.promise;
    }
}
new DeployWorkerHost();
function createNonEnumDesc(value) {
    return {
        value,
        writable: true,
        enumerable: false,
        configurable: true
    };
}
function createReadOnly(value) {
    return {
        value,
        writable: false,
        enumerable: true,
        configurable: false
    };
}
function createValueDesc(value) {
    return {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    };
}
