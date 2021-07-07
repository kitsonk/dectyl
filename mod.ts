// Copyright 2021 Deno Land Inc. All rights reserved. MIT license.

export { check, createWorker } from "./lib/deploy_worker.ts";
export type { DeployWorker } from "./lib/deploy_worker.ts";
export * as handlers from "./lib/handlers.ts";
export { LogLevel, setLevel as setLogLevel } from "./lib/logger.ts";
export * as testing from "./lib/testing.ts";
export type {
  DeployOptions,
  DeployWorkerInfo,
  FetchHandler,
} from "./types.d.ts";
