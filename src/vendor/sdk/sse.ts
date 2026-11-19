/**
 * SSE frame parsing for the SDK's streamed surfaces — the log stream and the
 * background-command output stream.
 *
 * The event stream is read with `fetch` rather than a native `EventSource`
 * because the credential rides the `Authorization` header and an `EventSource`
 * cannot send one; that means the frame parsing is ours too. The rules handled
 * here are the ones the wire actually exercises:
 *
 * - a frame is everything up to a blank line (`\n\n`, or `\r\n\r\n` — a proxy
 *   may rewrite line endings, and the spec allows both);
 * - `data:` lines carry the JSON payload; several of them join with `\n`;
 * - `:`-prefixed lines are comments — keepalives — and never become frames;
 * - the block after the last blank line stays buffered until its terminator
 *   arrives, so a frame split across TCP chunks is not torn in half.
 */
import type { z } from 'zod'

import { CorevelosContractError } from './client.js'

/** One parsed frame: the `event:` name and the joined `data:` text. */
export interface SseFrame {
  event: string
  data: string
}

/**
 * Parses a stream `Response` into frames. Breaking out of the loop cancels the
 * underlying body — the generator's `finally` runs on early `return`.
 */
export async function* parseSseFrames(response: Response): AsyncGenerator<SseFrame> {
  const body = response.body
  if (body === null) {
    throw new Error('The stream response has no body to read.')
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        // Flush a trailing frame the server closed without terminating. A
        // well-behaved server always sends the blank line; a dropped one may
        // not, and half a frame is still worth one attempt at parsing.
        if (buffer.length > 0) {
          const frame = parseBlock(buffer.replace(/\r\n/g, '\n'))
          if (frame !== undefined) yield frame
        }
        return
      }
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseBlock(block)
        if (frame !== undefined) yield frame
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    // Leaving the loop early — a `break`, a thrown caller error, a return —
    // must not leave the fetch running. Cancel is idempotent.
    void reader.cancel().catch(() => {})
  }
}

/** One blank-line-delimited block, or `undefined` when it carries no frame. */
function parseBlock(block: string): SseFrame | undefined {
  let event = ''
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
    // `retry:` and unknown fields are advisory; ignoring them is the spec's rule.
  }
  if (dataLines.length === 0) return undefined
  return { event, data: dataLines.join('\n') }
}

/**
 * Frames → validated contract events. Each `data` payload is parsed as JSON and
 * checked against the stream's own schema, so a wire drift throws
 * `CorevelosContractError` instead of handing the caller a made-up event — the
 * same guarantee `CorevelosClient.request` gives every REST read.
 */
export async function* validateSseEvents<Schema extends z.ZodTypeAny>(
  frames: AsyncGenerator<SseFrame>,
  schema: Schema,
  where: string,
): AsyncGenerator<z.infer<Schema>> {
  for await (const frame of frames) {
    let json: unknown
    try {
      json = JSON.parse(frame.data)
    } catch {
      throw new CorevelosContractError(`Stream ${where} sent a frame that is not JSON`, [])
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      throw new CorevelosContractError(`Stream ${where} sent a frame the contract rejects`, parsed.error.issues)
    }
    // The event name is the payload's discriminant; a mismatch means the two
    // halves of the frame disagree about what they are carrying.
    const type = (parsed.data as { type?: unknown }).type
    if (typeof type === 'string' && frame.event.length > 0 && frame.event !== type) {
      throw new CorevelosContractError(
        `Stream ${where} sent event "${frame.event}" with a "${type}" payload`,
        [],
      )
    }
    yield parsed.data
  }
}
