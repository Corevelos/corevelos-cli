/**
 * The facade's `Sandbox` — E2B's signatures over the Corevelos core.
 *
 * Every method here does exactly one thing: translate. Where E2B's signature
 * matches the core's, the method is a plain delegate (and says so); where it
 * differs, the difference and its reason are named at the method — so an E2B
 * customer can read this file as the migration guide it doubles as.
 */
import { Sandbox as CorevelosSandbox, type SandboxCreateOptions } from '../sandbox.js'
import type { CorevelosClientOptions } from '../client.js'
import type { ConnectionConfig } from './index.js'

export class Sandbox extends CorevelosSandbox {
  /**
   * E2B's `betaPause` — their beta-gated name for a plain pause. Corevelos'
   * pause is first-class and stable, so the facade simply exposes both
   * spellings of one operation.
   */
  async betaPause(signal?: AbortSignal): Promise<ReturnType<CorevelosSandbox['pause']>> {
    return this.pause(signal)
  }

  /** E2B's `files.read(path, format?)`: the `format` flag, re-joined. */
  async readFile(path: string, options: { format?: 'text' | 'bytes' } = {}): Promise<string | Uint8Array> {
    return options.format === 'bytes' ? this.files.readBytes(path) : this.files.read(path)
  }

  /** E2B's `files.write(path, data, format?)`: the `format` flag, re-joined. */
  async writeFile(
    path: string,
    data: string | Uint8Array,
    options: { format?: 'text' | 'bytes' } = {},
  ): Promise<void> {
    if (typeof data === 'string' && options.format === 'bytes') {
      await this.files.writeBytes(path, new TextEncoder().encode(data))
      return
    }
    if (typeof data === 'string') {
      await this.files.write(path, data)
      return
    }
    await this.files.writeBytes(path, data)
  }

  /**
   * E2B's `getHost(port)` builds the per-sandbox hostname direct traffic uses.
   *
   * The core's `getHost` is the same idea and the same hostname — the proxy
   * routes by it, so the name is not cosmetic. The one deviation from E2B's
   * shape: this is async, because a handle that did not come from a create
   * (a `connect`) has to ask the control plane for the domain first. A handle
   * born from `create` already knows it and resolves without a round trip.
   */
  override getHost(port?: number, signal?: AbortSignal): Promise<string> {
    return super.getHost(port, signal)
  }

  /**
   * E2B's browser-facing URL builder, mapped to the platform's preview URL:
   * the same hostname `getHost` returns, with a scheme and no path. Default
   * port 49983 matches E2B (envd's own port); pass the port your guest serves.
   */
  getSandboxUrl(port: number = 49983, signal?: AbortSignal): Promise<string> {
    return this.getPreviewUrl(port, { signal })
  }

  /** E2B's name for teardown; the core's `kill` is the same operation. */
  async close(): Promise<void> {
    await this.kill()
  }

  override async fork(options: Parameters<CorevelosSandbox['fork']>[0] = {}): Promise<Sandbox> {
    return Sandbox.fromCore(await super.fork(options))
  }

  /**
   * E2B's factory. The core's `create` already takes the same options; this
   * re-wraps the result so the facade's own methods (notably `close`) are on
   * it, and strips E2B's `domain` from a copied-over connection config. The
   * create's single-delivery traffic token rides along, so a restricted
   * sandbox's handle keeps its credential.
   */
  static override async create(
    options: SandboxCreateOptions & { client?: ConnectionConfig } = {},
  ): Promise<Sandbox> {
    return Sandbox.fromCore(await CorevelosSandbox.create(stripDomain(options)))
  }

  private static fromCore(core: CorevelosSandbox): Sandbox {
    return new Sandbox(core.sandboxId, core.client, {
      trafficAccessToken: core.trafficAccessToken,
      domain: core.domain,
      autoPause: core.autoPause,
      forkedFrom: core.forkedFrom,
    })
  }

  /** E2B's `connect` — same options, re-wrapped to the facade class. */
  static override connect(sandboxId: string, options: ConnectionConfig = {}): Sandbox {
    const { domain: _ignored, ...connection } = options
    const core = CorevelosSandbox.connect(sandboxId, connection)
    return new Sandbox(core.sandboxId, core.client)
  }

  // `list` is deliberately NOT overridden. E2B's `Sandbox.list` resolves to a
  // plain array; the core resolves to the page (`{ sandboxes, nextToken }`),
  // and an override changing that return shape would be a silent type break
  // for anyone holding the core's declaration. Call `.sandboxes` on the page —
  // the one deviation from E2B's shape this facade documents rather than hides.
}

/** Drops E2B's `domain` field, which the control-plane transport cannot use. */
function stripDomain(
  options: SandboxCreateOptions & { client?: ConnectionConfig },
): SandboxCreateOptions & { client?: CorevelosClientOptions } {
  const { client, ...rest } = options
  if (client === undefined) return rest
  const { domain: _ignored, ...connection } = client
  return { ...rest, client: connection }
}
