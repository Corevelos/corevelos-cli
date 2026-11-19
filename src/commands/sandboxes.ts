import { jsonFile, entries, boolFlag, json, numberFlag } from '../args.js'
import { defaultRequestSchemas, LivenessProbeSchema, RestartPolicySchema, SandboxNetworkPolicySchema, SandboxStateSchema, StorageBackendSchema } from '../vendor/sdk/contract/index.js'
import { Sandbox, runtime } from '../runtime.js'
/**
 * Sandbox commands: create, list, inspect, lifecycle, exec, snapshots,
 * preview URLs.
 *
 * Output discipline throughout: stdout carries what a script wants (the bare
 * sandbox id as the only line of `create`, command
 * output passthrough), stderr carries the human hints. A pipeline like
 * `id=$(corevelos sandbox create | tail -1)` is the intended use, so nothing
 * decorative ever lands on stdout's last line.
 */
import { parseArgs } from 'node:util'

import { Snapshots } from '../vendor/sdk/index.js'

import { CliError, printLine, type CommandSpec } from '../cli.js'

function requireId(argv: readonly string[], what: string): string {
  const id = argv[0]
  if (id === undefined || id.length === 0) {
    throw new CliError(`${what} requires a sandbox id as its first argument.`)
  }
  return id
}

/** Parse repeated KEY=value flags without ever printing the values. */
function parseEnvEntries(entries: readonly string[] | undefined): Record<string, string> {
  const envs: Record<string, string> = {}
  for (const entry of entries ?? []) {
    const equals = entry.indexOf('=')
    if (equals <= 0) throw new CliError('--env expects K=V.')
    envs[entry.slice(0, equals)] = entry.slice(equals + 1)
  }
  return envs
}

// ── lifecycle ───────────────────────────────────────────────────────────────

const create: CommandSpec = {
  path: 'sandbox create',
  summary: 'Create a sandbox and print its id.',
  usage:
    'corevelos sandbox create [--template <id>] [--project <proj_id>] [--timeout-seconds <n|-1>] [--exposure public|restricted] [--auto-pause true|false] [--idempotency-key <key>] [--auto-resume true|false] [--metadata K=V] [--volume id:/path] [--network <json-file>] [--backend xfs|s3|jfs] [--restart-policy Never|OnFailure|Always] [--liveness-probe <json-file>] [--spec <json-file>] [--verbose] [--show-token] [--env K=V]...',
  needsCredential: true,
  async run(argv, io) {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        spec: { type: 'string' },
        metadata: { type: 'string', multiple: true },
        volume: { type: 'string', multiple: true },
        network: { type: 'string' },
        backend: { type: 'string' },
        'restart-policy': { type: 'string' },
        'liveness-probe': { type: 'string' },
        'auto-resume': { type: 'string' },
        template: { type: 'string' },
        // Usually unnecessary: an API key is bound to one project, which already
        // selects it. Provided for a key allowed to span projects; a conflicting
        // value is refused by the service.
        project: { type: 'string' },
        'timeout-seconds': { type: 'string' },
        exposure: { type: 'string' },
        verbose: { type: 'boolean' },
        'show-token': { type: 'boolean' },
        env: { type: 'string', multiple: true },
        // A value flag like `exposure`, not a bare switch: `parseArgs` has no
        // `--no-` negation, and "explicit ephemeral" deserves the same clarity
        // as "explicit restricted". Omitted means the platform default —
        // pause, since persistence became it.
        'auto-pause': { type: 'string' },
        // Retry safety: the same key on a re-run replays the first create
        // instead of booting a second MicroVM. 8-255 characters is the
        // service's bound; generating one per operation is the caller's job.
        'idempotency-key': { type: 'string' },
      },
      allowPositionals: false,
    })
    const envs = parseEnvEntries(values.env)
    if (values.exposure !== undefined && values.exposure !== 'public' && values.exposure !== 'restricted') {
      throw new CliError(`--exposure must be public or restricted, got "${values.exposure}".`)
    }
    if (
      values['auto-pause'] !== undefined &&
      values['auto-pause'] !== 'true' &&
      values['auto-pause'] !== 'false'
    ) {
      throw new CliError(`--auto-pause must be true or false, got "${values['auto-pause']}".`)
    }
    if (
      values['idempotency-key'] !== undefined &&
      (values['idempotency-key'].length < 8 || values['idempotency-key'].length > 255)
    ) {
      throw new CliError('--idempotency-key must be 8-255 characters.')
    }
    const timeoutSeconds =
      values['timeout-seconds'] === undefined ? undefined : Number(values['timeout-seconds'])
    if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || (timeoutSeconds !== -1 && timeoutSeconds <= 0))) {
      throw new CliError(`--timeout-seconds must be -1 (unlimited while funded) or a positive integer.`)
    }

    const spec = values.spec
      ? defaultRequestSchemas.CreateSandboxBodySchema.parse(await jsonFile(values.spec))
      : {}
    const volumeMounts = (values.volume ?? []).map((value) => {
      const separator = value.indexOf(':')
      if (separator < 1) throw new CliError('--volume requires VOLUME_ID:/absolute/path.')
      return {
        name: value.slice(0, separator),
        path: value.slice(separator + 1),
      }
    })
    const sandbox = await Sandbox.create({
      ...spec,
      ...(values.metadata ? { metadata: entries(values.metadata) } : {}),
      ...(volumeMounts.length ? { volumeMounts } : {}),
      ...(values.network
        ? {
            network: SandboxNetworkPolicySchema.parse(await jsonFile(values.network)),
          }
        : {}),
      ...(values['auto-resume'] === undefined ? {} : { autoResume: boolFlag(values, 'auto-resume') }),
      ...(values.template === undefined ? {} : { template: values.template }),
      ...(values.project === undefined ? {} : { projectId: values.project }),
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      ...(values.exposure === undefined ? {} : { exposure: values.exposure }),
      ...(values.backend === undefined ? {} : { backend: StorageBackendSchema.parse(values.backend) }),
      ...(values['restart-policy'] === undefined ? {} : { restartPolicy: RestartPolicySchema.parse(values['restart-policy']) }),
      ...(values['liveness-probe'] === undefined ? {} : { livenessProbe: LivenessProbeSchema.parse(await jsonFile(values['liveness-probe'])) }),
      ...(values['auto-pause'] === undefined ? {} : { autoPause: values['auto-pause'] === 'true' }),
      ...(Object.keys(envs).length === 0 ? {} : { envs }),
      ...(values['idempotency-key'] === undefined ? {} : { idempotencyKey: values['idempotency-key'] }),
    })
    if (values.verbose) {
      const template = values.template ?? ('template' in spec ? spec.template : undefined) ?? 'default'
      io.err(`created ${sandbox.sandboxId} (template ${template})\n`)
      if (sandbox.autoPause !== undefined) {
        io.err(sandbox.autoPause ? 'pauses at timeout — storage keeps billing\n' : 'reclaims at timeout\n')
      }
    }
    // Tokens are opt-in, independently of verbose diagnostics. They can also
    // be retrieved later through `preview <id> --show-token`.
    if (values['show-token'] && sandbox.trafficAccessToken !== undefined) {
      io.err(`traffic token: ${sandbox.trafficAccessToken}\n`)
    }
    // The contract with pipelines: the last stdout line is the bare id.
    printLine(io, sandbox.sandboxId)
    return 0
  },
}

const list: CommandSpec = {
  path: 'sandbox list',
  summary: "List this credential's sandboxes.",
  usage:
    'corevelos sandbox list [--json] [--project <proj_id>] [--limit <1-100>] [--state running|paused|pausing|unknown] [--metadata K=V,K=V] [--next-token <cursor>]',
  needsCredential: true,
  async run(argv, io) {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        json: { type: 'boolean' },
        project: { type: 'string' },
        limit: { type: 'string' },
        state: { type: 'string' },
        metadata: { type: 'string' },
        'next-token': { type: 'string' },
      },
      allowPositionals: false,
    })
    const page = await Sandbox.list({
      projectId: values.project,
      limit: numberFlag(values, 'limit'),
      state: SandboxStateSchema.optional().parse(values.state),
      label: values.metadata,
      nextToken: values['next-token'],
    })
    if (values.json) {
      json(io, page)
      return 0
    }
    if (page.nextToken) io.err(`next token: ${page.nextToken}\n`)
    if (page.sandboxes.length === 0) {
      printLine(io, 'no sandboxes')
      return 0
    }
    for (const sandbox of page.sandboxes) {
      const deadline = sandbox.timeoutSeconds === -1 ? '  unlimited while funded' : sandbox.endAt === undefined ? '' : `  ends ${sandbox.endAt}`
      printLine(io, `${sandbox.sandboxId}  ${sandbox.state.padEnd(8)}  ${sandbox.template}${deadline}`)
    }
    return 0
  },
}

const get: CommandSpec = {
  path: 'sandbox get',
  summary: "Print one sandbox's record.",
  usage: 'corevelos sandbox get <id> [--json] [--cost]',
  needsCredential: true,
  async run(argv, io) {
    const { positionals, values } = parseArgs({
      args: [...argv],
      options: { json: { type: 'boolean' }, cost: { type: 'boolean' } },
      allowPositionals: true,
    })
    if (positionals.length !== 1) throw new CliError('sandbox get requires one id.')
    const id = positionals[0]!
    const sandbox = Sandbox.connect(id)
    const detail = await sandbox.getInfo()
    const cost = values.cost ? await sandbox.getCost() : undefined
    if (values.json) {
      json(io, cost ? { ...detail, cost } : detail)
      return 0
    }
    printLine(io, `id:          ${detail.sandboxId}`)
    printLine(io, `state:       ${detail.state}`)
    printLine(io, `template:    ${detail.template}`)
    printLine(io, `started at:  ${detail.startedAt}`)
    if (detail.timeoutSeconds === -1) printLine(io, 'lifetime:    unlimited while funded')
    else if (detail.endAt !== undefined) printLine(io, `ends at:     ${detail.endAt}`)
    // The recorded disposition, when there is one: what the deadline will do
    // is the question `get` exists to answer. Absent means this control plane
    // never saw the create — printed as nothing rather than a guess.
    if (detail.autoPause !== undefined) {
      printLine(io, `at timeout:  ${detail.autoPause ? 'pauses' : 'reclaims'}`)
    }
    if (detail.cpuCount !== undefined) printLine(io, `vCPUs:       ${detail.cpuCount}`)
    if (detail.memoryMB !== undefined) printLine(io, `memory (MB): ${detail.memoryMB}`)
    if (cost) {
      const micros = BigInt(cost.subtotalMicros)
      const amount = `${micros / 1_000_000n}.${String(micros % 1_000_000n).padStart(6, '0')}`
      printLine(io, `cost:        ${cost.currency} ${amount}${cost.provisional ? ' (provisional)' : ''}`)
    }
    return 0
  },
}

const pause: CommandSpec = {
  path: 'sandbox pause',
  summary: 'Pause a running sandbox.',
  usage: 'corevelos sandbox pause <id>',
  needsCredential: true,
  async run(argv, io) {
    if (argv.length !== 1) throw new CliError('sandbox pause requires one id.')
    const id = requireId(argv, 'sandbox pause')
    await Sandbox.connect(id).pause()
    printLine(io, `paused ${id}`)
    return 0
  },
}

const resume: CommandSpec = {
  path: 'sandbox resume',
  summary: 'Resume a paused sandbox.',
  usage: 'corevelos sandbox resume <id> [--timeout-seconds <n|-1>] [--auto-pause true|false]',
  needsCredential: true,
  async run(argv, io) {
    const id = requireId(argv, 'sandbox resume')
    const { values } = parseArgs({
      args: [...argv.slice(1)],
      options: {
        'timeout-seconds': { type: 'string' },
        'auto-pause': { type: 'string' },
      },
    })
    await Sandbox.connect(id).resume({
      timeoutSeconds: values['timeout-seconds'] === undefined ? undefined : Number(values['timeout-seconds']),
      autoPause: boolFlag(values, 'auto-pause'),
    })
    printLine(io, `resumed ${id}`)
    return 0
  },
}

const kill: CommandSpec = {
  path: 'sandbox kill',
  summary: 'Delete a sandbox and everything in it. Idempotent.',
  usage: 'corevelos sandbox kill <id>',
  needsCredential: true,
  async run(argv, io) {
    if (argv.length !== 1) throw new CliError('sandbox kill requires one id.')
    const id = requireId(argv, 'sandbox kill')
    await Sandbox.connect(id).kill()
    printLine(io, `killed ${id}`)
    return 0
  },
}

// ── exec ────────────────────────────────────────────────────────────────────

const exec: CommandSpec = {
  path: 'exec',
  summary: 'Run a command in a sandbox; stream output, keep the exit code.',
  usage: 'corevelos exec <id> [--timeout-ms <n>] [--cwd <path>] [--env K=V]... -- <command> [args...]',
  needsCredential: true,
  async run(argv, io) {
    const id = requireId(argv, 'exec')
    const rest = argv.slice(1)
    const divider = rest.indexOf('--')
    const before = divider === -1 ? rest : rest.slice(0, divider)
    const commandArgs = divider === -1 ? [] : rest.slice(divider + 1)
    const { values } = parseArgs({
      args: [...before],
      options: {
        'timeout-ms': { type: 'string' },
        cwd: { type: 'string' },
        // Per-command environment injection is important for agent templates:
        // provider credentials can be scoped to one Pi invocation instead of
        // being persisted on the sandbox record for every future command.
        env: { type: 'string', multiple: true },
      },
      allowPositionals: false,
    })
    if (commandArgs.length === 0) {
      throw new CliError('exec needs a command after --, e.g. corevelos exec <id> -- ls -la')
    }
    const timeoutMs = values['timeout-ms'] === undefined ? 120_000 : Number(values['timeout-ms'])
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new CliError('--timeout-ms must be a positive integer.')
    }

    const envs = parseEnvEntries(values.env)
    const result = await Sandbox.connect(id, {
      timeoutMs: timeoutMs + 5000,
    }).commands.run(commandArgs.join(' '), {
      cwd: values.cwd,
      signal: runtime.getStore()?.signal,
      timeoutMs,
      ...(Object.keys(envs).length === 0 ? {} : { envs }),
    })
    if (result.stdout.length > 0) io.out(result.stdout)
    if (result.stderr.length > 0) io.err(result.stderr)
    if (result.exitCode !== 0) {
      io.err(`exit code ${result.exitCode}\n`)
      return result.exitCode
    }
    return 0
  },
}

// ── snapshots ───────────────────────────────────────────────────────────────

const snapshotCreate: CommandSpec = {
  path: 'snapshot create',
  summary: 'Snapshot a running sandbox.',
  usage: 'corevelos snapshot create <id> [--name <name>] [--mode full|fs-only]',
  needsCredential: true,
  async run(argv, io) {
    const id = requireId(argv, 'snapshot create')
    const { values } = parseArgs({
      args: [...argv.slice(1)],
      options: { name: { type: 'string' }, mode: { type: 'string' } },
      allowPositionals: false,
    })
    if (values.mode !== undefined && values.mode !== 'full' && values.mode !== 'fs-only')
      throw new CliError('--mode must be full or fs-only.')
    const created = await Sandbox.connect(id).createSnapshot({ name: values.name, mode: values.mode })
    io.err(`snapshot of ${id} created\n`)
    printLine(io, created.snapshotId)
    return 0
  },
}

const snapshotList: CommandSpec = {
  path: 'snapshot list',
  summary: 'List snapshots, optionally for one sandbox.',
  usage:
    'corevelos snapshot list [sandboxId] [--json] [--name <name-or-id>] [--limit <n>] [--next-token <cursor>] [--backend <name>]',
  needsCredential: true,
  async run(argv, io) {
    const { positionals, values } = parseArgs({
      args: [...argv],
      options: {
        json: { type: 'boolean' },
        limit: { type: 'string' },
        'next-token': { type: 'string' },
        backend: { type: 'string' },
        name: { type: 'string' },
      },
      allowPositionals: true,
    })
    if (positionals.length > 1) throw new CliError('snapshot list accepts at most one sandboxId.')
    const page = await new Snapshots(Sandbox.connect('none').client).list({
      sandboxId: positionals[0],
      limit: values.limit === undefined ? undefined : Number(values.limit),
      nextToken: values['next-token'],
      backend: values.backend,
      name: values.name,
    })
    if (values.json) {
      json(io, page)
      return 0
    }
    if (page.nextToken) io.err(`next token: ${page.nextToken}\n`)
    if (page.snapshots.length === 0) {
      printLine(io, 'no snapshots')
      return 0
    }
    for (const snapshot of page.snapshots) {
      const name = snapshot.names.length === 0 ? '' : `  ${snapshot.names.join(',')}`
      const origin = snapshot.originSandboxId === undefined ? '' : `  of ${snapshot.originSandboxId}`
      printLine(io, `${snapshot.snapshotId}  ${snapshot.status}${name}${origin}`)
    }
    return 0
  },
}

// ── preview URLs ────────────────────────────────────────────────────────────

const preview: CommandSpec = {
  path: 'preview',
  summary: "Print a sandbox's preview URL for a port.",
  usage: 'corevelos preview <id> [port] [--path <p>] [--show-token]',
  needsCredential: true,
  async run(argv, io) {
    const id = requireId(argv, 'preview')
    const { positionals, values } = parseArgs({
      args: [...argv.slice(1)],
      options: { path: { type: 'string' }, 'show-token': { type: 'boolean' } },
      allowPositionals: true,
    })
    if (positionals.length > 1) throw new CliError('preview accepts at most one port.')
    const port = positionals[0] === undefined ? 80 : Number(positionals[0])
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new CliError('port must be an integer between 1 and 65535.')
    }
    const sandbox = Sandbox.connect(id)
    const url = await sandbox.getPreviewUrl(port, values.path === undefined ? {} : { path: values.path })
    const info = await sandbox.getPreviewInfo()
    if (info.exposure === 'restricted') {
      io.err(
        "exposure restricted: requests need the sandbox's traffic token as the e2b-traffic-access-token header.\n",
      )
      if (values['show-token'] && info.trafficAccessToken)
        io.err(`traffic token: ${info.trafficAccessToken}\n`)
    }
    printLine(io, url)
    return 0
  },
}

export const sandboxCommands: readonly CommandSpec[] = [
  create,
  list,
  get,
  pause,
  resume,
  kill,
  exec,
  snapshotCreate,
  snapshotList,
  preview,
]
