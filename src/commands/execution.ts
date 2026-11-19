import { StringDecoder } from 'node:string_decoder'
import { Sandbox, runtime } from '../runtime.js'
import { args, command, numberFlag, positional, textFlag } from '../args.js'
import { CliError } from '../cli.js'

export const executionCommands = [
  command(
    'sandbox connect',
    'Open an interactive shell over authenticated PTY.',
    'corevelos sandbox connect <id> [--pid <pid>] [--cwd <path>] [--timeout-ms <n>]',
    async (argv, io) => {
      const { positionals: p, values: v } = args(argv, {
        pid: 'string',
        cwd: 'string',
        'timeout-ms': 'string',
      })
      positional(p, 1, 'Expected <id>.')
      const input = runtime.getStore()?.terminal?.input ?? process.stdin,
        output = runtime.getStore()?.terminal?.output ?? process.stdout
      if (!input.isTTY || !output.isTTY)
        throw new CliError('Interactive PTY requires a terminal. Use exec for pipelines.')
      const wasRaw = input.isRaw,
        wasFlowing = input.readableFlowing,
        decoder = new StringDecoder('utf8')
      return await new Promise<number>((resolve) => {
        let settled = false,
          ready = false
        const cleanup = () => {
          input.off('data', onData)
          output.off('resize', resize)
          input.off('end', onEnd)
          runtime.getStore()?.signal?.removeEventListener('abort', cancel)
          input.setRawMode(wasRaw)
          if (!wasFlowing) input.pause()
          session.close()
          io.out(decoder.end())
        }
        const finish = (code: number) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(code)
        }
        const onData = (bytes: Buffer) => session.input(bytes)
        const resize = () => session.resize(output.columns ?? 80, output.rows ?? 24)
        const onEnd = () => finish(0)
        const cancel = () => finish(130)
        const session = Sandbox.connect(p[0]!).pty.connect({
          cols: output.columns ?? 80,
          rows: output.rows ?? 24,
          pid: numberFlag(v, 'pid'),
          cwd: textFlag(v, 'cwd'),
          timeoutMs: numberFlag(v, 'timeout-ms'),
          signal: runtime.getStore()?.signal,
          onData: (bytes) => io.out(decoder.write(Buffer.from(bytes))),
          onReady: () => {
            ready = true
            input.setRawMode(true)
            input.on('data', onData)
            input.once('end', onEnd)
            output.on('resize', resize)
            input.resume()
          },
          onExit: (info) => {
            if (info.error) io.err(info.error + '\n')
            finish(info.error ? 1 : (info.exitCode ?? 0))
          },
          onClose: (code, reason) => {
            if (!settled) {
              io.err(
                `PTY ${ready ? 'disconnected' : 'connection failed'} (${code})${reason ? ': ' + reason : ''}\n`,
              )
              finish(1)
            }
          },
        })
        runtime.getStore()?.signal?.addEventListener('abort', cancel, { once: true })
        if (runtime.getStore()?.signal?.aborted) cancel()
      })
    },
  ),
]
