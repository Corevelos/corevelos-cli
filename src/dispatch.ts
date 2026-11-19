/**
 * Command dispatch: match the leading words of argv against the command table,
 * run the handler with what remains, and translate every failure into the
 * shell contract — a message on stderr and a non-zero exit code.
 *
 * Two words of path (`sandbox create`) resolve before one (`sandbox`); an
 * exact prefix match that is not itself a command (bare `sandbox`) prints the
 * subcommands under it rather than a generic usage dump.
 */
import { CliError, printError, printLine, type CliIo, type CommandSpec } from './cli.js'
import { completion, version } from './completion.js'
import { storageCommands } from './commands/storage.js'
import { executionCommands } from './commands/execution.js'
import { fileCommands } from './commands/files.js'
import { observabilityCommands } from './commands/observability.js'
import { lifecycleCommands } from './commands/lifecycle.js'
import { workspaceCommands } from './commands/workspaces.js'
import { authCommands } from './commands/auth.js'
import { runtime, type CliRuntime } from './runtime.js'
import { configuredEndpoint, endpoint, SessionStore } from './session.js'
import { mcpCommands } from './commands/mcp.js'
import { sandboxCommands } from './commands/sandboxes.js'

/** The complete executable catalog; also the sole input to help and completion. */
export const COMMANDS: readonly CommandSpec[] = [
  {
    path: 'version',
    summary: 'Print the installed CLI version.',
    usage: 'corevelos version',
    needsCredential: false,
    async run(argv, io) {
      if (argv.length) throw new CliError('version takes no arguments.')
      return version(io)
    },
  },
  {
    path: 'completion',
    summary: 'Generate shell completion scripts.',
    usage: 'corevelos completion <bash|zsh|fish|powershell>',
    needsCredential: false,
    async run(argv, io) {
      if (argv.length !== 1) throw new CliError('completion requires a shell.')
      io.out(completion(argv[0]!, COMMANDS))
      return 0
    },
  },
  ...authCommands,
  ...workspaceCommands,
  ...sandboxCommands,
  ...lifecycleCommands,
  ...executionCommands,
  ...fileCommands,
  ...observabilityCommands,
  ...storageCommands,
  ...mcpCommands,
]

/** Longest command path, for aligned help output. */
const PATH_WIDTH = Math.max(...COMMANDS.map((command) => command.path.length))

/** Root help is an overview; --all lists the 35 supported actions. */
const HELP_SECTIONS = [
  {
    title: 'sandbox and development commands',
    groups: {
      auth: 'Sign in, select an organization and configure the endpoint.',
      workspace: 'List accessible workspaces.',
      sandbox: 'Create, inspect, connect and manage sandbox lifecycle.',
      exec: 'Run a shell command in a sandbox.',
      files: 'Upload and download sandbox files.',
      snapshot: 'Create, list and delete sandbox snapshots.',
      preview: 'Get a preview URL for a sandbox port.',
      template: 'Build and manage OCI sandbox templates.',
      volume: 'Manage persistent volumes.',
      mcp: 'Start the MCP server and configure agent clients.',
    },
  },
  {
    title: 'utility commands',
    groups: {
      version: 'Print the installed CLI version.',
      completion: 'Generate shell completion scripts.',
    },
  },
] as const

function findCommand(argv: readonly string[]): { spec: CommandSpec; rest: readonly string[] } | undefined {
  // Two-word paths first so `sandbox create` never resolves as bare `sandbox`.
  for (const words of [2, 1]) {
    if (argv.length < words) continue
    const prefix = argv.slice(0, words).join(' ')
    const spec = COMMANDS.find((command) => command.path === prefix)
    if (spec !== undefined) return { spec, rest: argv.slice(words) }
  }
  return undefined
}

function printHelp(io: CliIo, filter?: string, all = false): boolean {
  const commands = COMMANDS.filter(
    (command) => filter === undefined || command.path.startsWith(`${filter} `) || command.path === filter,
  )
  if (commands.length === 0) {
    io.err(`error: unknown command "${filter}"\n`)
    return false
  }
  const exact = commands.find((command) => command.path === filter)
  if (exact && commands.length === 1) {
    printLine(io, exact.summary)
    printLine(io, exact.usage)
    return true
  }
  printLine(io, 'corevelos — the Corevelos control plane from a shell')
  printLine(io, '')
  printLine(io, 'usage: corevelos <command> [flags]')
  printLine(io, '')
  if (filter === undefined && !all) {
    printLine(io, 'get started:')
    printLine(io, '  corevelos auth login')
    printLine(io, '  corevelos sandbox create')
    printLine(io, '  corevelos sandbox connect <sandboxId>')
    for (const section of HELP_SECTIONS) {
      printLine(io, '')
      printLine(io, `${section.title}:`)
      for (const [group, summary] of Object.entries(section.groups)) {
        printLine(io, `  ${group.padEnd(16)}  ${summary}`)
      }
    }
  } else {
    if (exact) printLine(io, exact.usage)
    printLine(io, 'commands:')
    for (const command of commands) {
      printLine(io, `  ${command.path.padEnd(PATH_WIDTH)}  ${command.summary}`)
    }
  }
  printLine(io, '')
  printLine(io, 'credential: corevelos auth login, or COREVELOS_API_KEY for automation.')
  printLine(io, '            COREVELOS_API_URL overrides auth configure; default https://api.corevelos.com.')
  printLine(io, 'help:       corevelos help [command]   corevelos <command> --help.')
  printLine(io, 'all:        corevelos help --all')
  return true
}

export interface RunCliOptions {
  /** Invocation-local environment for endpoint, credentials and configuration. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  configDir?: string
  signal?: AbortSignal
  terminal?: CliRuntime['terminal']
  openBrowser?: CliRuntime['openBrowser']
}

/**
 * Run one invocation. Returns the process exit code: 0 on success, 1 on any
 * failure the user can read a message about, or the command's own code when
 * it has a meaningful one (`exec` propagates the guest's exit code).
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  options: RunCliOptions = {},
): Promise<number> {
  // The `--` divider is meaningful to `exec`, so argv
  // passes through untouched — only the leading command words are consumed.
  const args = argv
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) return version(io)
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    const helpArgs = args.slice(1)
    const all = helpArgs.includes('--all')
    const scope = helpArgs.filter((arg) => arg !== '--all').join(' ')
    return printHelp(io, scope.length === 0 ? undefined : scope, all) ? 0 : 1
  }

  const matched = findCommand(args)
  if (matched === undefined) {
    const word = args[0]
    // A prefix that is not itself a command (`corevelos sandbox`) lists its
    // subcommands; anything else is unknown.
    if (
      COMMANDS.some((command) => command.path.startsWith(`${word} `)) &&
      (args.length === 1 || (args.length === 2 && ['--help', '-h'].includes(args[1]!)))
    ) {
      printHelp(io, word)
      return 0
    }
    io.err(`error: unknown command "${args.slice(0, 2).join(' ')}"\n`)
    io.err('run `corevelos help` for the command list.\n')
    return 1
  }

  if (matched.rest.includes('--help') || matched.rest.includes('-h')) {
    // Only flags before the shell divider belong to the CLI.
    const divider = matched.rest.indexOf('--')
    const flags = divider < 0 ? matched.rest : matched.rest.slice(0, divider)
    if (flags.includes('--help') || flags.includes('-h')) {
      printHelp(io, matched.spec.path)
      return 0
    }
  }
  try {
    const env = options.env ?? process.env
    if (['completion', 'version'].includes(matched.spec.path)) return await matched.spec.run(matched.rest, io)
    const apiBaseUrl =
      matched.spec.path === 'auth configure' ? endpoint({}) : await configuredEndpoint(env, options.configDir)
    const store = new SessionStore(apiBaseUrl, env, options.configDir)
    let apiKey = env.COREVELOS_API_KEY
    if (matched.spec.needsCredential && !apiKey)
      apiKey = (await store.active(undefined, options.signal)).accessToken
    return await runtime.run(
      {
        env,
        configDir: options.configDir,
        signal: options.signal,
        terminal: options.terminal,
        openBrowser: options.openBrowser,
        clientOptions: {
          apiBaseUrl,
          signal: options.signal,
          apiKey: apiKey ?? null,
          ...(matched.spec.needsCredential && !env.COREVELOS_API_KEY
            ? {
                credentialProvider: async () => (await store.active(undefined, options.signal)).accessToken,
              }
            : {}),
        },
      },
      () => matched.spec.run(matched.rest, io),
    )
  } catch (error) {
    printError(io, error)
    return 1
  }
}
