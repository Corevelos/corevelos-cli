/** Invocation-local clients: concurrent invocations never mutate process.env. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { CorevelosClient, Sandbox as SdkSandbox } from './vendor/sdk/index.js'
import type { CorevelosClientOptions, SandboxCreateOptions, SandboxListOptions } from './vendor/sdk/index.js'

export interface CliRuntime {
  env: Record<string, string | undefined>
  clientOptions: CorevelosClientOptions
  configDir?: string
  signal?: AbortSignal
  terminal?: { input: typeof process.stdin; output: typeof process.stdout }
  openBrowser?: (url: string, signal?: AbortSignal) => Promise<void>
}
export const runtime = new AsyncLocalStorage<CliRuntime>()
export function client(): CorevelosClient {
  return new CorevelosClient(runtime.getStore()?.clientOptions)
}
// Preserve the existing handlers' vocabulary while binding every client to the
// invocation's endpoint and credential, including the long-running MCP server.
export const Sandbox = {
  connect: (id: string, options: CorevelosClientOptions = {}) =>
    SdkSandbox.connect(id, {
      ...runtime.getStore()?.clientOptions,
      ...options,
    }),
  create: (options: SandboxCreateOptions = {}) =>
    SdkSandbox.create({
      ...options,
      client: runtime.getStore()?.clientOptions,
    }),
  list: (options: SandboxListOptions = {}) =>
    SdkSandbox.list({ ...options, client: runtime.getStore()?.clientOptions }),
}
