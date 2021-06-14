// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

export { createWorker } from "./lib/deploy_worker.ts";
export type { DeployWorker } from "./lib/deploy_worker.ts";
export { LogLevel, setLevel as setLogLevel } from "./lib/logger.ts";
export type { DeployOptions, DeployWorkerInfo } from "./types.d.ts";
