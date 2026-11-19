import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Auth, CorevelosApiError, CorevelosClient } from './vendor/sdk/index.js'
import { AuthSessionSchema, type AuthSession } from './vendor/sdk/contract/index.js'
import { CliError } from './cli.js'

export function endpoint(env: Record<string, string | undefined>): string {
  const url = new URL(env.COREVELOS_API_URL ?? 'https://api.corevelos.com')
  if (url.username || url.password || url.search || url.hash)
    throw new CliError('COREVELOS_API_URL must have no credentials, query or fragment.')
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new CliError('COREVELOS_API_URL requires HTTPS (HTTP is allowed only on loopback).')
  }
  return url.toString().replace(/\/+$/, '')
}
export async function configuredEndpoint(
  env: Record<string, string | undefined>,
  configDir?: string,
): Promise<string> {
  if (env.COREVELOS_API_URL) return endpoint(env)
  const store = new SessionStore('http://127.0.0.1:8787', env, configDir)
  try {
    const info = await lstat(join(store.dir, 'config.json'))
    if (!info.isFile() || info.isSymbolicLink()) throw new CliError('CLI config must be a regular file.')
    const data = JSON.parse(await readFile(join(store.dir, 'config.json'), 'utf8')) as {
      apiBaseUrl?: unknown
    }
    if (typeof data.apiBaseUrl !== 'string') throw new CliError('CLI config has no valid endpoint.')
    return endpoint({ ...env, COREVELOS_API_URL: data.apiBaseUrl })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return endpoint(env)
    throw error
  }
}
export class SessionStore {
  readonly dir: string
  readonly path: string
  constructor(
    readonly apiBaseUrl: string,
    env: Record<string, string | undefined>,
    configDir?: string,
  ) {
    this.dir =
      configDir ??
      env.COREVELOS_CONFIG_DIR ??
      join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config'), 'corevelos')
    this.path = join(this.dir, `session-${createHash('sha256').update(apiBaseUrl).digest('hex')}.json`)
  }
  private async ensureDir() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const stat = await lstat(this.dir)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()))
      throw new CliError('Credential directory must be a directory owned by the current user.')
    await chmod(this.dir, 0o700)
  }
  async read(): Promise<AuthSession | undefined> {
    try {
      const directory = await lstat(this.dir)
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        (process.getuid && directory.uid !== process.getuid())
      )
        throw new CliError('Credential directory must be a directory owned by the current user.')
      if (process.platform !== 'win32' && (directory.mode & 0o077) !== 0)
        throw new CliError('Credential directory permissions must be 0700.')
      const stat = await lstat(this.path)
      if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()))
        throw new CliError('Credential file must be a regular file owned by the current user.')
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        throw new CliError(
          'Credential file permissions must be 0600. Run chmod 600 on the Corevelos session file.',
        )
      const data = JSON.parse(await readFile(this.path, 'utf8')) as {
        apiBaseUrl?: unknown
        session?: unknown
      }
      if (data.apiBaseUrl !== this.apiBaseUrl)
        throw new CliError('Stored session belongs to another endpoint.')
      return AuthSessionSchema.parse(data.session)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      if (error instanceof CliError) throw error
      throw new CliError(
        'Stored Corevelos session is invalid. Run corevelos auth logout --local, then auth login.',
      )
    }
  }
  async configure(): Promise<void> {
    await this.ensureDir()
    const temp = join(this.dir, `config-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, JSON.stringify({ apiBaseUrl: this.apiBaseUrl }), {
        flag: 'wx',
        mode: 0o600,
      })
      await rename(temp, join(this.dir, 'config.json'))
    } finally {
      await rm(temp, { force: true })
    }
  }
  async save(session: AuthSession): Promise<void> {
    await this.ensureDir()
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ apiBaseUrl: this.apiBaseUrl, session }), {
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temp, this.path)
    } finally {
      await rm(temp, { force: true })
    }
  }
  async clear() {
    await rm(this.path, { force: true })
  }
  /** Serialize rotating-token exchanges across processes; re-read inside lock. */
  async locked<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.ensureDir()
    const lock = `${this.path}.lock`
    const deadline = Date.now() + 30_000
    for (;;) {
      signal?.throwIfAborted()
      try {
        await mkdir(lock, { mode: 0o700 })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        // A terminated CLI can leave a lock; requests have a 15s deadline.
        const stat = await lstat(lock).catch(() => undefined)
        if (stat && Date.now() - stat.mtimeMs > 120_000) {
          await rm(lock, { recursive: true, force: true })
          continue
        }
        if (Date.now() > deadline)
          throw new CliError('Another CLI process is refreshing this session. Retry shortly.')
        await sleep(100, undefined, { signal })
      }
    }
    try {
      return await run()
    } finally {
      await rm(lock, { recursive: true, force: true })
    }
  }
  async active(organizationId?: string, signal?: AbortSignal): Promise<AuthSession> {
    const session = await this.read()
    if (!session) throw new CliError('No saved session. Run corevelos auth login or set COREVELOS_API_KEY.')
    if (organizationId === undefined && Date.parse(session.expiresAt) > Date.now() + 60_000) return session
    return this.locked(() => this.refreshLatest(organizationId, signal), signal)
  }
  /** Must run while holding the session lock, including during logout. */
  private async refreshLatest(organizationId?: string, signal?: AbortSignal): Promise<AuthSession> {
    const latest = await this.read()
    if (!latest) throw new CliError('Session was cleared. Run corevelos auth login.')
    if (organizationId === undefined && Date.parse(latest.expiresAt) > Date.now() + 60_000) return latest
    try {
      const next = await new Auth(
        new CorevelosClient({
          apiBaseUrl: this.apiBaseUrl,
          timeoutMs: 15_000,
          apiKey: null,
        }),
      ).refresh(latest.refreshToken, organizationId, signal)
      if (
        next.user.id !== latest.user.id ||
        (organizationId !== undefined && next.organizationId !== organizationId)
      ) {
        await this.clear()
        throw new CliError('WorkOS returned an unexpected user or organization. Run auth login again.')
      }
      await this.save(next)
      return next
    } catch (error) {
      if (
        error instanceof CorevelosApiError &&
        (error.details as { upstreamCode?: string } | undefined)?.upstreamCode === 'invalid_grant'
      ) {
        await this.clear()
        throw new CliError('WorkOS session expired or was revoked. Run corevelos auth login.')
      }
      throw error
    }
  }
  async revokeAndClear(signal?: AbortSignal): Promise<void> {
    await this.locked(async () => {
      if (!(await this.read())) return
      try {
        const session = await this.refreshLatest(undefined, signal)
        await new Auth(
          new CorevelosClient({
            apiBaseUrl: this.apiBaseUrl,
            apiKey: session.accessToken,
            timeoutMs: 15_000,
            signal,
          }),
        ).logout()
      } catch (error) {
        // Revoked/expired credentials need only local cleanup. Transient
        // failures retain the session so revocation can be retried.
        if (!(error instanceof CorevelosApiError && error.status === 401) && (await this.read())) throw error
      }
      await this.clear()
    }, signal)
  }
}
