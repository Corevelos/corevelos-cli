#!/usr/bin/env node
/**
 * Wire process I/O and cancellation; flush pipe output before terminating.
 */
import { processIo } from './cli.js'
import { runCli } from './dispatch.js'

const controller = new AbortController()
let signalExitCode = 130
const interrupt = (exitCode: number) => {
  signalExitCode = exitCode
  controller.abort()
  // Terminal and MCP reads must also unblock on process cancellation.
  process.stdin.destroy()
}
const sigint = () => interrupt(130)
const sigterm = () => interrupt(143)
process.once('SIGINT', sigint)
process.once('SIGTERM', sigterm)
const brokenPipe = (error: NodeJS.ErrnoException) => process.exit(error.code === 'EPIPE' ? 0 : 1)
process.stdout.on('error', brokenPipe)
process.stderr.on('error', brokenPipe)
const code = await runCli(process.argv.slice(2), processIo, {
  signal: controller.signal,
})
process.off('SIGINT', sigint)
process.off('SIGTERM', sigterm)
await Promise.all(
  [process.stdout, process.stderr].map(
    (stream) => new Promise<void>((resolve) => stream.write('', () => resolve())),
  ),
)
process.exit(controller.signal.aborted ? signalExitCode : code)
