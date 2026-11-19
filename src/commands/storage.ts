import { Templates, Volumes } from '../vendor/sdk/index.js'
import { CreateTemplateBodySchema, CreateVolumeBodySchema } from '../vendor/sdk/contract/index.js'
import { setTimeout as sleep } from 'node:timers/promises'
import { client, runtime } from '../runtime.js'
import { args, command, json, jsonFile, noArgs, numberFlag, positional, textFlag } from '../args.js'
import { CliError, printLine } from '../cli.js'
const templates = () => new Templates(client()),
  volumes = () => new Volumes(client())
export const storageCommands = [
  command(
    'template list',
    'List bootable templates or snapshots.',
    'corevelos template list [--kind template|snapshot|all] [--source platform|user|all] [--instance-type <type>] [--limit <1-100>] [--offset <n>]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, {
        kind: 'string',
        source: 'string',
        'instance-type': 'string',
        limit: 'string',
        offset: 'string',
      })
      positional(p, 0, 'Unexpected positional argument.')
      const kind = textFlag(v, 'kind') ?? 'template'
      const source = textFlag(v, 'source') ?? 'all'
      if (!['platform', 'user', 'all'].includes(source)) throw new CliError('Invalid --source.')
      if (!['template', 'snapshot', 'all'].includes(kind)) throw new CliError('Invalid --kind.')
      json(
        io,
        await templates().list({
          kind: kind as 'template' | 'snapshot' | 'all',
          source: source as 'platform' | 'user' | 'all',
          instanceType: textFlag(v, 'instance-type'),
          limit: numberFlag(v, 'limit'),
          offset: numberFlag(v, 'offset', 0),
        }),
      )
      return 0
    },
  ),
  command(
    'template delete',
    'Delete a template.',
    'corevelos template delete <templateId>',
    async (argv, io) => {
      const p = positional(args(argv).positionals, 1, 'Expected <templateId>.')
      json(io, await templates().delete(p[0]!))
      return 0
    },
  ),
  command(
    'template build',
    'Build a template from an OCI image/spec.',
    'corevelos template build (--image <ref> | --spec <json>) [--name <name>] [--cpu <millicores>] [--memory <MiB>] [--wait] [--wait-timeout-seconds <n>]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, {
        image: 'string',
        spec: 'string',
        name: 'string',
        cpu: 'string',
        memory: 'string',
        wait: 'boolean',
        'wait-timeout-seconds': 'string',
      })
      positional(p, 0, 'Unexpected positional argument.')
      if (Boolean(v.spec) === Boolean(v.image))
        throw new CliError('Provide exactly one of --image or --spec.')
      const input = CreateTemplateBodySchema.parse(
        v.spec
          ? await jsonFile(textFlag(v, 'spec')!)
          : {
              image: v.image,
              name: v.name,
              cpu: numberFlag(v, 'cpu'),
              memory: numberFlag(v, 'memory'),
            },
      )
      const duration = (numberFlag(v, 'wait-timeout-seconds') ?? 600) * 1000
      if (duration > 2_147_483_647) throw new CliError('--wait-timeout-seconds is too large.')
      const job = await templates().create(input, runtime.getStore()?.signal)
      io.err(`Build ${job.buildId} started for ${job.templateId}.\n`)
      if (v.wait) {
        const deadline = Date.now() + duration,
          signal = AbortSignal.any([
            AbortSignal.timeout(duration),
            ...(runtime.getStore()?.signal ? [runtime.getStore()!.signal!] : []),
          ])
        try {
          while (Date.now() < deadline) {
            const status = await templates().buildStatus(job.templateId, job.buildId, signal)
            io.err(`${status.status} ${status.progress}%${status.message ? ': ' + status.message : ''}\n`)
            if (status.state === 'ready') {
              printLine(io, job.templateId)
              return 0
            }
            if (status.state === 'failed')
              throw new CliError(`Template build failed: ${status.message ?? status.status}`)
            await sleep(2000, undefined, { signal })
          }
        } catch (error) {
          if (!signal.aborted) throw error
          throw new CliError(
            `Build wait ${runtime.getStore()?.signal?.aborted ? 'cancelled' : 'timed out'}. Inspect with template status ${job.templateId} ${job.buildId}.`,
          )
        }
        throw new CliError(
          `Build wait timed out. Inspect with template status ${job.templateId} ${job.buildId}.`,
        )
      }
      json(io, job)
      return 0
    },
  ),
  ...(['status', 'logs'] as const).map((action) =>
    command(
      `template ${action}`,
      `Read template build ${action}.`,
      `corevelos template ${action} <templateId> <buildId>`,
      async (argv, io) => {
        const p = positional(args(argv).positionals, 2, 'Expected <templateId> <buildId>.')
        json(
          io,
          action === 'status'
            ? await templates().buildStatus(p[0]!, p[1]!)
            : await templates().buildLogs(p[0]!, p[1]!),
        )
        return 0
      },
    ),
  ),
  command('volume list', 'List persistent volumes.', 'corevelos volume list', async (argv, io) => {
    noArgs(argv)
    json(io, await volumes().list())
    return 0
  }),
  command(
    'volume delete',
    'Delete a persistent volume.',
    'corevelos volume delete <volumeId>',
    async (argv, io) => {
      const p = positional(args(argv).positionals, 1, 'Expected <volumeId>.')
      json(io, await volumes().delete(p[0]!))
      return 0
    },
  ),
  command(
    'volume create',
    'Create persistent storage for sandbox mounts.',
    'corevelos volume create [--name <id>] [--driver <driver>] [--project <proj_id>] [--spec <json-file>]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, {
        name: 'string',
        driver: 'string',
        project: 'string',
        spec: 'string',
      })
      positional(p, 0, 'Unexpected positional argument.')
      const path = textFlag(v, 'spec')
      const spec = path === undefined ? {} : CreateVolumeBodySchema.parse(await jsonFile(path))
      json(
        io,
        await volumes().create({
          ...spec,
          name: textFlag(v, 'name') ?? spec.name,
          driver: textFlag(v, 'driver') ?? spec.driver,
          projectId: textFlag(v, 'project') ?? spec.projectId,
        }),
      )
      return 0
    },
  ),
]
