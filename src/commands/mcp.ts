/** Official MCP transport; stdout belongs exclusively to the protocol. */
import { parseArgs } from 'node:util'
import { isAbsolute } from 'node:path'
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio'
import { CliError, type CommandSpec } from '../cli.js'
import { noArgs } from '../args.js'
import { runtime } from '../runtime.js'
import { createMcpServer } from '../vendor/mcp/server.js'
import { selectTools, type McpProfile, type McpGroup } from '../vendor/mcp/profiles.js'

const selectionFlags = {
  profile: { type: 'string', default: 'agent' },
  group: { type: 'string', multiple: true },
  tool: { type: 'string', multiple: true },
  'read-only': { type: 'boolean' },
} as const
function selection(values: { profile?: string; group?: string[]; tool?: string[]; 'read-only'?: boolean }) {
  const options = {
    profile: values.profile as McpProfile,
    groups: values.group as McpGroup[] | undefined,
    tools: values.tool,
    readOnly: values['read-only'],
  }
  try {
    if (!selectTools(options).length) throw new Error('Selection enables no tools.')
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : 'Invalid MCP selection.')
  }
  return options
}

const start: CommandSpec = {
  path: 'mcp start',
  summary: 'Serve a minimal set of sandbox MCP tools over stdio.',
  usage:
    'corevelos mcp start [--profile <agent|sandbox|full>] [--group <group>...] [--tool <name>...] [--read-only]',
  needsCredential: true,
  async run(argv, io) {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: selectionFlags,
      allowPositionals: true,
      strict: true,
    })
    noArgs(positionals)
    const selected = selection(values)
    const invocation = runtime.getStore()
    const signal = invocation?.signal
    const transport = new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 128 * 1024,
    })
    let finish!: () => void
    const closed = new Promise<void>((resolve) => {
      finish = resolve
    })
    // serveStdio owns onclose: wrap close itself to observe EOF without replacing its callbacks.
    const close = transport.close.bind(transport)
    transport.close = async () => {
      await close()
      finish()
    }
    const handle = serveStdio(
      () => createMcpServer({ clientOptions: invocation?.clientOptions, signal, ...selected }),
      {
        transport,
        onerror: () => io.err('corevelos mcp: invalid protocol input or transport failure.\n'),
        maxSubscriptions: 16,
      },
    )
    const abort = () => {
      void handle.close().finally(finish)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    io.err('corevelos mcp: stdio server ready.\n')
    try {
      await closed
      return 0
    } finally {
      signal?.removeEventListener('abort', abort)
      await handle.close()
    }
  },
}

export const mcpCommands: readonly CommandSpec[] = [
  start,
  {
    path: 'mcp config',
    summary: 'Print credential-free MCP client configuration.',
    usage:
      'corevelos mcp config [--client <claude|cursor|windsurf|vscode>] [--profile <agent|sandbox|full>] [--group <group>...] [--tool <name>...] [--read-only] [--command <absolute-cli-path>]',
    needsCredential: false,
    async run(argv, io) {
      const { values, positionals } = parseArgs({
        args: [...argv],
        options: {
          client: { type: 'string', default: 'claude' },
          ...selectionFlags,
          command: { type: 'string' },
        },
        strict: true,
        allowPositionals: true,
      })
      noArgs(positionals)
      selection(values)
      if (!['claude', 'cursor', 'windsurf', 'vscode'].includes(values.client!))
        throw new CliError('Unsupported MCP client; use claude, cursor, windsurf or vscode.')
      if (values.command && !isAbsolute(values.command))
        throw new CliError('--command must be an absolute path to the installed CLI executable.')
      const args = [
        'mcp',
        'start',
        ...(values.profile !== 'agent' ? ['--profile', values.profile!] : []),
        ...(values.group ?? []).flatMap((g) => ['--group', g]),
        ...(values.tool ?? []).flatMap((t) => ['--tool', t]),
        ...(values['read-only'] ? ['--read-only'] : []),
      ]
      const command = values.command ?? process.execPath
      // Absolute Node + bundled script works even when a desktop host has a minimal PATH.
      if (!values.command) args.unshift(process.argv[1]!)
      const entry = {
        command,
        args,
        env: {
          COREVELOS_API_URL: runtime.getStore()!.clientOptions.apiBaseUrl!,
          ...(runtime.getStore()?.configDir || runtime.getStore()?.env.COREVELOS_CONFIG_DIR
            ? {
                COREVELOS_CONFIG_DIR:
                  runtime.getStore()?.configDir ?? runtime.getStore()?.env.COREVELOS_CONFIG_DIR,
              }
            : {}),
        },
      }
      io.out(
        JSON.stringify(
          values.client === 'vscode'
            ? { servers: { corevelos: { type: 'stdio', ...entry } } }
            : { mcpServers: { corevelos: entry } },
          null,
          2,
        ) + '\n',
      )
      return 0
    },
  },
]
