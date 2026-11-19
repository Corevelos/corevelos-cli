import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { Auth, CorevelosApiError, CorevelosClient } from '../vendor/sdk/index.js'
import { CliError, printLine, type CommandSpec } from '../cli.js'
import { client, runtime } from '../runtime.js'
import { endpoint, SessionStore } from '../session.js'

function store() {
  const ctx = runtime.getStore()!
  return new SessionStore(ctx.clientOptions.apiBaseUrl!, ctx.env, ctx.configDir)
}
export async function openBrowser(url: string, signal?: AbortSignal): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:')
    throw new CliError('Browser authentication requires an HTTPS verification URL.')
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      shell: false,
      signal,
    })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Browser did not open'))))
  })
}
const login: CommandSpec = {
  path: 'auth login',
  summary: 'Sign in through WorkOS browser device authorization.',
  usage: 'corevelos auth login [--no-browser]',
  needsCredential: false,
  async run(argv, io) {
    const { values } = parseArgs({
      args: [...argv],
      options: { 'no-browser': { type: 'boolean' } },
    })
    const ctx = runtime.getStore()!
    const auth = new Auth(
      new CorevelosClient({
        apiBaseUrl: ctx.clientOptions.apiBaseUrl,
        timeoutMs: 15_000,
        apiKey: null,
      }),
    )
    const device = await auth.authorizeDevice(ctx.signal).catch((error: unknown) => {
      // Cancellation can arrive during the first HTTP request, before the poll
      // loop's abort handler exists. Keep the same user-facing result in both.
      if (ctx.signal?.aborted) throw new CliError('Login cancelled.')
      throw error
    })
    const deadline = Date.now() + device.expiresIn * 1000
    const signal = AbortSignal.any([
      AbortSignal.timeout(device.expiresIn * 1000),
      ...(ctx.signal ? [ctx.signal] : []),
    ])
    const verification = new URL(device.verificationUriComplete ?? device.verificationUri)
    if (verification.protocol !== 'https:')
      throw new CliError('WorkOS returned a non-HTTPS verification URL.')
    io.err(`Open ${verification.toString()}\nConfirm code: ${device.userCode}\n`)
    if (!values['no-browser']) {
      const browserSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)])
      await (ctx.openBrowser ?? openBrowser)(verification.toString(), browserSignal).catch(() => {
        io.err('Could not open a browser. Use the URL above on any device.\n')
      })
    }
    let interval = device.interval * 1000
    try {
      while (Date.now() < deadline) {
        await sleep(interval, undefined, { signal })
        try {
          const session = await auth.exchangeDevice(device.deviceCode, signal)
          await store().locked(() => store().save(session), signal)
          printLine(
            io,
            `Signed in as ${session.user.email ?? session.user.id}${session.organizationId ? ` (${session.organizationId})` : ''}.`,
          )
          if (ctx.env.COREVELOS_API_KEY)
            io.err('COREVELOS_API_KEY is set and takes precedence over this saved session.\n')
          return 0
        } catch (error) {
          if (!(error instanceof CorevelosApiError)) throw error
          const upstreamCode = (error.details as { upstreamCode?: string } | undefined)?.upstreamCode
          if (upstreamCode === 'authorization_pending') continue
          if (upstreamCode === 'slow_down') {
            interval += 5000
            continue
          }
          if (upstreamCode === 'access_denied') throw new CliError('WorkOS authorization was declined.')
          if (upstreamCode === 'expired_token')
            throw new CliError('WorkOS authorization expired. Run auth login again.')
          // Bound transient retries by the device-code deadline; never restart
          // authorization implicitly or persist a partial session.
          if (error.status === 429 || error.status >= 500) {
            interval = Math.min(interval + 5000, 30_000)
            continue
          }
          throw error
        }
      }
    } catch (error) {
      if (signal.aborted)
        throw new CliError(
          ctx.signal?.aborted ? 'Login cancelled.' : 'WorkOS authorization timed out. Run auth login again.',
        )
      throw error
    }
    throw new CliError('WorkOS authorization timed out. Run auth login again.')
  },
}
const logout: CommandSpec = {
  path: 'auth logout',
  summary: 'Revoke the saved WorkOS session and remove local tokens.',
  usage: 'corevelos auth logout [--local]',
  needsCredential: false,
  async run(argv, io) {
    const { values } = parseArgs({
      args: [...argv],
      options: { local: { type: 'boolean' } },
    })
    const saved = store()
    if (values.local) await saved.locked(() => saved.clear(), runtime.getStore()?.signal)
    else await saved.revokeAndClear(runtime.getStore()?.signal)
    printLine(io, values.local ? 'Local session removed.' : 'Signed out.')
    if (runtime.getStore()?.env.COREVELOS_API_KEY)
      io.err('COREVELOS_API_KEY is still set; unset it to stop using that credential.\n')
    return 0
  },
}
const status: CommandSpec = {
  path: 'auth status',
  summary: 'Show the identity verified by the platform.',
  usage: 'corevelos auth status',
  needsCredential: true,
  async run(argv, io) {
    parseArgs({ args: [...argv], options: {} })
    const identity = await new Auth(client()).me()
    printLine(io, JSON.stringify({ endpoint: client().apiBaseUrl, ...identity }, null, 2))
    return 0
  },
}
const use: CommandSpec = {
  path: 'auth use',
  summary: 'Switch the WorkOS session to an organization membership.',
  usage: 'corevelos auth use <org_id>',
  needsCredential: true,
  async run(argv, io) {
    if (argv.length !== 1 || !/^org_[A-Za-z0-9]+$/.test(argv[0]!))
      throw new CliError('auth use requires a WorkOS org_id.')
    if (runtime.getStore()?.env.COREVELOS_API_KEY)
      throw new CliError('Unset COREVELOS_API_KEY to switch your saved WorkOS session.')
    const next = await store().active(argv[0], runtime.getStore()?.signal)
    printLine(io, `Using ${next.organizationId}.`)
    return 0
  },
}
const configure: CommandSpec = {
  path: 'auth configure',
  summary: 'Save the API endpoint for subsequent invocations.',
  usage: 'corevelos auth configure --api-url <https://endpoint>',
  needsCredential: false,
  async run(argv, io) {
    const { values } = parseArgs({
      args: [...argv],
      options: { 'api-url': { type: 'string' } },
    })
    if (!values['api-url']) throw new CliError('--api-url is required.')
    const ctx = runtime.getStore()!,
      apiBaseUrl = endpoint({ COREVELOS_API_URL: values['api-url'] })
    await new SessionStore(apiBaseUrl, ctx.env, ctx.configDir).configure()
    printLine(io, `Configured ${apiBaseUrl}.`)
    if (ctx.env.COREVELOS_API_URL) io.err('COREVELOS_API_URL is set and overrides this saved endpoint.\n')
    return 0
  },
}
export const authCommands: readonly CommandSpec[] = [login, logout, status, use, configure]
