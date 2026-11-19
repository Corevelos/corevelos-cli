/**
 * The E2B compatibility facade — the migration door.
 *
 * This module speaks E2B's *call shapes* over the Corevelos engine: a customer
 * with an existing `@e2b/code-interpreter` integration changes one import line
 * (`'@e2b/code-interpreter'` → `'@corevelos/sdk/e2b'`) and their code runs
 * against this platform. It is translation, nothing more — every method
 * forwards to the Corevelos core (`..`), which owns the transport, auth,
 * validation and billing attribution.
 *
 * What this is deliberately NOT: wire-level impersonation. Pointing the real
 * `e2b` npm package at a Corevelos URL does not work and is not a goal — E2B's
 * wire talks directly to `envd` inside the sandbox, bypassing exactly the
 * control-plane layer this platform sells. That refusal is recorded as a
 * decision in `TODO.md`.
 *
 * Facade rules (from the Option D decision record):
 * - E2B's names and module shapes where E2B has the concept.
 * - E2B's quirks are absorbed HERE (`betaPause` is E2B's name; our pause is
 *   first-class) so their breaking changes never cascade into the core.
 * - Corevelos-only surfaces (billing, per-key usage) are not disguised as E2B
 *   anything — reach them from the core entry, `@corevelos/sdk`.
 * - E2B's error classes (`SandboxNotFoundError`, …) are NOT emulated: errors
 *   stay the core's typed `CorevelosApiError`, branchable on `error.code` —
 *   faking another vendor's error taxonomy would be fabricating behavior.
 * - E2B surfaces with no platform behind them (`getHost`'s hostname routing,
 *   secrets manager, git, IAM tokens, filesystem watch, MCP) are not present
 *   here at all — the "never fabricate" rule, the same one the console obeys.
 */
import type { CorevelosClientOptions } from '../client.js'

export { Sandbox } from './sandbox.js'
export { waitForTimeout } from './waitFor.js'

/**
 * E2B's `CodeInterpreter` — their code-interpreter entry class. In E2B it *is*
 * `Sandbox` plus a notebook facade; here it is the facade `Sandbox`, whose core
 * already carries `runCode` (stateful kernel, results, logs, error-as-result).
 */
export { Sandbox as CodeInterpreter } from './sandbox.js'

/**
 * E2B's connection-credentials shape, mapped honestly: E2B's object carries an
 * API key and a domain; ours carries a key and a base URL. Accepting E2B's
 * spelling and forwarding is the facade's whole job — but the domain field is
 * ignored with an explanation, not silently mis-applied.
 */
export interface ConnectionConfig extends CorevelosClientOptions {
  /**
   * Accepted and ignored. E2B uses it to build per-sandbox hostnames for
   * direct-to-sandbox traffic; Corevelos routes everything through the control
   * plane, so there is nothing for a domain to route. Passing it is harmless —
   * a copied-over config should work, not confuse.
   */
  domain?: string
}
