/**
 * The command-line surface: argument parsing, output formatting, exit codes.
 *
 * Thin by design. Every command maps onto an SDK surface that is already
 * tested — the CLI adds no service logic and makes no call the SDK does not.
 * What it owns is the contract with the shell: stable output formats so
 * pipelines work, errors on stderr with the service's own code, exit code 0
 * only on success, and the credential story (`COREVELOS_API_KEY`, read by the
 * SDK itself, never echoed back).
 */

/** Where a command writes. Injected so the suite can capture, the bin can use process. */
export interface CliIo {
  out(text: string): void
  err(text: string): void
}

export const processIo: CliIo = {
  out: (text) => {
    process.stdout.write(text)
  },
  err: (text) => {
    process.stderr.write(text)
  },
}

/** One command's implementation: argv is what remains after the command path. */
export type CommandHandler = (argv: readonly string[], io: CliIo) => Promise<number>

export interface CommandSpec {
  /** Full invocation path, e.g. `sandbox create`. */
  path: string
  summary: string
  usage: string
  /** Whether the command needs a saved session or automation API key. */
  needsCredential: boolean
  run: CommandHandler
}

/** A failure that already knows its exit presentation — thrown by handlers, rendered once. */
export class CliError extends Error {
  constructor(
    message: string,
    /** Machine-readable where the service gave us one (`CorevelosApiError.code`). */
    readonly code?: string,
  ) {
    super(message)
  }
}

export function printLine(io: CliIo, text = ''): void {
  io.out(`${text}\n`)
}

export function printError(io: CliIo, error: unknown): void {
  if (error instanceof TypeError && error.message === 'fetch failed') {
    const causeCode = (error.cause as { code?: unknown } | undefined)?.code
    io.err(
      `error: Could not reach the configured API. Check auth configure, connectivity and the server certificate${typeof causeCode === 'string' && /^[A-Z0-9_]+$/.test(causeCode) ? ` (${causeCode})` : ''}.\n`,
    )
    return
  }
  if (error instanceof CliError) {
    io.err(`error: ${error.message}${error.code === undefined ? '' : ` (${error.code})`}\n`)
    return
  }
  const code = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : String(error)
  io.err(`error: ${message}${typeof code === 'string' ? ` (${code})` : ''}\n`)
}
