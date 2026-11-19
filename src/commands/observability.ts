import { Sandbox, runtime } from '../runtime.js'
import { args, command, json, numberFlag, positional, textFlag } from '../args.js'
import { CliError, printLine } from '../cli.js'
export const observabilityCommands = [
  command(
    'sandbox is-running',
    'Check the sandbox state without waking it.',
    'corevelos sandbox is-running <id>',
    async (argv, io) => {
      const [id] = positional(args(argv).positionals, 1, 'Expected <id>.')
      json(io, { running: await Sandbox.connect(id!).isRunning() })
      return 0
    },
  ),
  command(
    'sandbox exposed-port',
    'Look up a declared TCP port on a public sandbox.',
    'corevelos sandbox exposed-port <id> <port>',
    async (argv, io) => {
      const [id, value] = positional(args(argv).positionals, 2, 'Expected <id> <port>.')
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new CliError('port must be an integer between 1 and 65535.')
      }
      json(io, await Sandbox.connect(id!).getExposedPort(port))
      return 0
    },
  ),
  command(
    'sandbox metrics',
    'Read resource metrics from the guest or node.',
    'corevelos sandbox metrics <id> [--source host|guest-workload|guest]',
    async (argv, io) => {
      const { positionals, values } = args(argv, { source: 'string' })
      const p = positional(positionals, 1, 'Expected <id>.')
      const source = textFlag(values, 'source') ?? 'guest'
      if (source !== 'host' && source !== 'guest' && source !== 'guest-workload')
        throw new CliError('--source must be host, guest-workload or guest.')
      json(io, await Sandbox.connect(p[0]!).getMetrics(undefined, source))
      return 0
    },
  ),
  command(
    'sandbox logs',
    'Read or follow VM lifecycle logs.',
    'corevelos sandbox logs <id> [--limit <n>] [--follow]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, {
        limit: 'string',
        follow: 'boolean',
      })
      positional(p, 1, 'Expected <id>.')
      const sandbox = Sandbox.connect(p[0]!),
        limit = numberFlag(v, 'limit')
      if (!v.follow) {
        json(io, await sandbox.getLogs({ limit }))
        return 0
      }
      for await (const event of sandbox.streamLogs({
        limit,
        signal: runtime.getStore()?.signal,
      })) {
        if (event.type === 'snapshot') {
          for (const log of event.logs) printLine(io, `${log.timestamp} ${log.message}`)
          if (event.truncated) io.err('Older lifecycle logs were truncated.\n')
        } else if (event.type === 'log') printLine(io, `${event.entry.timestamp} ${event.entry.message}`)
        else if (event.type === 'gone') {
          io.err('Sandbox no longer exists.\n')
          return 0
        }
      }
      return 0
    },
  ),
]
