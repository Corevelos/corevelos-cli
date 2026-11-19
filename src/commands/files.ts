import { readFile, writeFile } from 'node:fs/promises'
import { Sandbox } from '../runtime.js'
import { args, command, positional } from '../args.js'
export const fileCommands = [
  command(
    'files upload',
    'Upload local file bytes without text decoding.',
    'corevelos files upload <id> <localFile> <guestPath>',
    async (argv, io) => {
      const p = positional(args(argv).positionals, 3, 'Expected <id> <localFile> <guestPath>.')
      const bytes = await readFile(p[1]!)
      await Sandbox.connect(p[0]!).files.writeBytes(p[2]!, bytes)
      io.err(`Uploaded ${bytes.length} bytes.\n`)
      return 0
    },
  ),
  command(
    'files download',
    'Download guest file bytes; refuse overwrite unless --force.',
    'corevelos files download <id> <guestPath> <localFile> [--force]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, { force: 'boolean' })
      positional(p, 3, 'Expected <id> <guestPath> <localFile>.')
      const bytes = await Sandbox.connect(p[0]!).files.readBytes(p[1]!)
      await writeFile(p[2]!, bytes, {
        flag: v.force ? 'w' : 'wx',
        mode: 0o600,
      })
      io.err(`Downloaded ${bytes.length} bytes.\n`)
      return 0
    },
  ),
]
