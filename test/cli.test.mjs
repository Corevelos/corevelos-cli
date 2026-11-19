import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
test('built CLI calls the mock API and creates credential-free MCP config', async () => {
  const fixture = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer dummy-token')
    assert.equal(request.url, '/api/v1/sandboxes')
    response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({
      sandboxId: 'fixture-vm', template: 'template', state: 'running', metadata: {}, startedAt: '2026-01-01T00:00:00Z',
    }))
  }).listen(0, '127.0.0.1')
  await once(fixture, 'listening')
  try {
    const env = { ...process.env, COREVELOS_API_KEY: 'dummy-token', COREVELOS_API_URL: 'http://127.0.0.1:' + fixture.address().port }
    const created = await exec(process.execPath, ['dist/corevelos.js', 'sandbox', 'create'], { env })
    assert.equal(created.stdout.trim(), 'fixture-vm')
    const config = await exec(process.execPath, ['dist/corevelos.js', 'mcp', 'config', '--client', 'vscode'], { env })
    assert.equal(JSON.parse(config.stdout).servers.corevelos.type, 'stdio')
    assert.doesNotMatch(config.stdout + config.stderr, /dummy-token/)
  } finally {
    fixture.closeAllConnections()
    await new Promise(resolve => fixture.close(resolve))
  }
})
