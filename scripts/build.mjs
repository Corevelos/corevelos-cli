import { build } from 'esbuild'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/corevelos.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20.11',
  banner: {
    js: "import { createRequire as corevelosCreateRequire } from 'node:module'; const require = corevelosCreateRequire(import.meta.url);",
  },
  external: ['bufferutil', 'utf-8-validate'],
  metafile: true,
  legalComments: 'inline',
  logLevel: 'info',
})
// A release must never retain a runtime dependency on an unpublished workspace.
for (const output of Object.values(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (!isBuiltin(dependency.path) && !['bufferutil', 'utf-8-validate'].includes(dependency.path))
      throw new Error(`Unbundled runtime import: ${dependency.path}`)
  }
}
await chmod(join(root, 'dist/corevelos.js'), 0o755)
const notices = ['Corevelos CLI bundled third-party licenses.\n']
const packages = new Map()
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules')) continue
  let folder = dirname(resolve(root, input))
  while (folder !== dirname(folder)) {
    try {
      const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
      if (manifest.name && manifest.version) {
        packages.set(`${manifest.name}@${manifest.version}`, { folder, manifest })
        break
      }
    } catch {
      /* Walk from an entry point to its package directory. */
    }
    folder = dirname(folder)
  }
}
for (const [name, { folder, manifest }] of [...packages].sort()) {
  let license
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt']) {
    try {
      license = await readFile(join(folder, file), 'utf8')
      break
    } catch {
      /* Try package spelling. */
    }
  }
  if (!license) throw new Error(`Could not locate bundled ${name} license`)
  notices.push(`\n--- ${name} (${manifest.license}) ---\n${license}`)
}
await writeFile(join(root, 'THIRD_PARTY_LICENSES.txt'), notices.join('\n'))
