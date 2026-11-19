import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { CliError, printLine, type CliIo, type CommandSpec } from './cli.js'

type Flags = Record<string, string | boolean | string[] | undefined>
export function args(argv: readonly string[], flags: Record<string, 'string' | 'boolean' | 'multi'> = {}) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: Object.fromEntries(
      Object.entries(flags).map(([name, type]) => [
        name,
        type === 'multi' ? { type: 'string', multiple: true } : { type },
      ]),
    ),
  }) as { values: Flags; positionals: string[] }
}
export function textFlag(values: Flags, name: string): string | undefined {
  return values[name] as string | undefined
}
export function numberFlag(values: Flags, name: string, min = 1): number | undefined {
  const value = textFlag(values, name)
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min) throw new CliError(`--${name} must be an integer >= ${min}.`)
  return n
}
export function boolFlag(values: Flags, name: string): boolean | undefined {
  const value = textFlag(values, name)
  if (value === undefined) return undefined
  if (value !== 'true' && value !== 'false') throw new CliError(`--${name} must be true or false.`)
  return value === 'true'
}
export function positional(positionals: string[], count: number, usage: string): string[] {
  if (positionals.length !== count || positionals.some((x) => !x)) throw new CliError(usage)
  return positionals
}
export function entries(entries: readonly string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of entries ?? []) {
    const i = entry.indexOf('=')
    if (i <= 0) throw new CliError('Expected KEY=VALUE.')
    result[entry.slice(0, i)] = entry.slice(i + 1)
  }
  return result
}
export async function jsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    throw new CliError(`Could not read valid JSON from ${path}.`)
  }
}
export function json(io: CliIo, value: unknown) {
  printLine(io, JSON.stringify(value, null, 2))
}
export function command(
  path: string,
  summary: string,
  usage: string,
  run: CommandSpec['run'],
  needsCredential = true,
): CommandSpec {
  return { path, summary, usage, run, needsCredential }
}
export function noArgs(argv: readonly string[]) {
  positional(args(argv).positionals, 0, 'This command takes no arguments.')
}
