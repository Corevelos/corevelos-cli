import { Snapshots } from '../vendor/sdk/index.js'
import { SnapshotModeSchema } from '../vendor/sdk/contract/index.js'
import { Sandbox, client, runtime } from '../runtime.js'
import { args, command, json, numberFlag, positional, textFlag } from '../args.js'
import { printLine } from '../cli.js'
export const lifecycleCommands = [
  command(
    'sandbox fork',
    'Fork a running VM with a full or filesystem-only snapshot.',
    'corevelos sandbox fork <id> [--snapshot-mode full|fs-only] [--snapshot-name <name>] [--timeout-seconds <n|-1>] [--idempotency-key <key>] [--show-token]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, {
        'timeout-seconds': 'string',
        'idempotency-key': 'string',
        'snapshot-mode': 'string',
        'snapshot-name': 'string',
        'show-token': 'boolean',
      })
      positional(p, 1, 'Expected <id>.')
      const child = await Sandbox.connect(p[0]!).fork({
        timeoutSeconds: numberFlag(v, 'timeout-seconds', -1),
        idempotencyKey: textFlag(v, 'idempotency-key'),
        snapshotMode: SnapshotModeSchema.optional().parse(textFlag(v, 'snapshot-mode')),
        snapshotName: textFlag(v, 'snapshot-name'),
        signal: runtime.getStore()?.signal,
      })
      if (v['show-token'] && child.trafficAccessToken) io.err(`traffic token: ${child.trafficAccessToken}\n`)
      if (child.forkedFrom)
        io.err(
          `Backing snapshot: ${child.forkedFrom.snapshotId}. Reclaim it with snapshot delete after killing the child.\n`,
        )
      printLine(io, child.sandboxId)
      return 0
    },
  ),
  command(
    'snapshot delete',
    'Reclaim an unreferenced snapshot.',
    'corevelos snapshot delete <snapshotId>',
    async (argv, io) => {
      const p = positional(args(argv).positionals, 1, 'Expected <snapshotId>.')
      json(io, await new Snapshots(client()).delete(p[0]!))
      return 0
    },
  ),
]
