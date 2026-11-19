import { Projects } from '../vendor/sdk/index.js'
import { client } from '../runtime.js'
import { command, json, noArgs } from '../args.js'

export const workspaceCommands = [
  command(
    'workspace list',
    'List personal and organization workspaces.',
    'corevelos workspace list',
    async (argv, io) => {
      noArgs(argv)
      json(io, await new Projects(client()).workspaces())
      return 0
    },
  ),
]
