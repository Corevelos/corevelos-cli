/**
 * E2B's client-side wait helpers — the ones that need no platform surface.
 *
 * `waitForTimeout` is a pure sleep in E2B and stays one here. E2B's other
 * `waitFor*` helpers (`waitForFile`, `waitForPort`, `waitForProcess`,
 * `waitForURL`) poll sandbox internals E2B reaches over its direct-to-sandbox
 * wire; the Corevelos equivalents are ordinary `commands`/`files` calls in a
 * loop, and the SDK's own customers already have the primitives — so the
 * facade ships the pure one and points at the primitives for the rest rather
 * than shipping five half-matched helpers.
 */

/** Resolve after `ms` milliseconds. E2B's `waitForTimeout`, unchanged. */
export async function waitForTimeout(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
