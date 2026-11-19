import { readFile } from 'node:fs/promises'
import { CliError, printLine, type CliIo, type CommandSpec } from './cli.js'
export async function version(io: CliIo) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  printLine(io, pkg.version)
  return 0
}
/** Generate completion from the same catalog used by dispatch and help. */
export function completion(shell: string, commands: readonly CommandSpec[]): string {
  const groups = [...new Set(commands.map((c) => c.path.split(' ')[0]!))].sort()
  const branches = groups.filter((g) => commands.some((c) => c.path.startsWith(g + ' ')))
  const contexts = new Map<string, string[]>([
    ['', [...groups, 'help', '--help', '-h', '--version', '-v']],
    ['help', [...groups, '--all', '--help', '-h']],
  ])
  const values = new Map<string, string[]>()
  for (const group of branches) {
    const actions = commands
      .filter((c) => c.path.startsWith(group + ' '))
      .map((c) => c.path.split(' ')[1]!)
      .sort()
    contexts.set(group, [...actions, '--help', '-h'])
    contexts.set(`help ${group}`, [...actions, '--all', '--help', '-h'])
  }
  for (const c of commands) {
    contexts.set(c.path, [...new Set(c.usage.match(/--[a-z][a-z-]*/g) ?? []), '--help', '-h'])
    values.set(
      c.path,
      [...c.usage.matchAll(/(--[a-z][a-z-]*)\s+(?=<|[A-Za-z0-9])/g)].map((m) => m[1]!),
    )
  }
  const entries = [...contexts]
  // A group consumes two command words; a direct command consumes just one.
  // Ignore arguments after that, and stop offering CLI flags after the guest divider.
  if (shell === 'bash')
    return `_corevelos_complete() {
  local word="\${COMP_WORDS[COMP_CWORD]}" key="" choices="" value_flags="" start=1 i
  COMPREPLY=()
  for ((i=1; i<COMP_CWORD; i++)); do
    [[ "\${COMP_WORDS[i]}" == -- ]] && return
  done
  if [[ "\${COMP_WORDS[1]}" == help && $COMP_CWORD -gt 1 ]]; then start=2; key=help; fi
  if (( COMP_CWORD > start )); then
    [[ $start -eq 2 ]] && key="help "
    key+="\${COMP_WORDS[start]}"
    case "\${COMP_WORDS[start]}" in
      ${branches.join('|')})
        if (( COMP_CWORD > start+1 )); then key+=" \${COMP_WORDS[start+1]}"; fi ;;
    esac
  fi
  case "$key" in
${entries.map(([key, flags]) => `    '${key}') choices="${flags.join(' ')}"; value_flags="${(values.get(key) ?? []).join(' ')}" ;;`).join('\n')}
  esac
  for i in $value_flags; do
    [[ "\${COMP_WORDS[COMP_CWORD-1]}" == "$i" ]] && return
  done
  COMPREPLY=( $(compgen -W "$choices" -- "$word") )
}
complete -F _corevelos_complete corevelos
`
  if (shell === 'zsh')
    return `#compdef corevelos
_corevelos() {
  local key="" start=2 i
  local -a choices value_flags
  for ((i=2; i<CURRENT; i++)); do
    [[ "$words[i]" == -- ]] && return
  done
  if [[ "$words[2]" == help && $CURRENT -gt 2 ]]; then start=3; key=help; fi
  if (( CURRENT > start )); then
    [[ $start -eq 3 ]] && key="help "
    key+="$words[start]"
    case "$words[start]" in
      ${branches.join('|')})
        if (( CURRENT > start+1 )); then key+=" $words[start+1]"; fi ;;
    esac
  fi
  case "$key" in
${entries.map(([key, flags]) => `    '${key}') choices=(${flags.join(' ')}); value_flags=(${(values.get(key) ?? []).join(' ')}) ;;`).join('\n')}
  esac
  for i in $value_flags; do
    [[ "$words[CURRENT-1]" == "$i" ]] && return
  done
  compadd -- $choices
}
compdef _corevelos corevelos
`
  if (shell === 'fish')
    return `function _corevelos_context
  set -l words (commandline -xpc)
  contains -- -- $words; and return 1
  set -l key ''
  set -l start 2
  if test (count $words) -ge 2; and test "$words[2]" = help
    set start 3
    set key help
  end
  if test (count $words) -ge $start
    if test $start -eq 3
      set key "help "
    end
    set key "$key$words[$start]"
    if contains -- "$words[$start]" ${branches.join(' ')}; and test (count $words) -gt $start
      set -l next (math $start + 1)
      set key "$key $words[$next]"
    end
  end
  test "$key" = "$argv[1]"
end
complete -c corevelos -f
${entries
  .flatMap(([key, flags]) =>
    flags.map((flag) => {
      const condition = `_corevelos_context "${key}"`
      if (flag.startsWith('--'))
        return `complete -c corevelos -n '${condition}' -l ${flag.slice(2)}${values.get(key)?.includes(flag) ? ' -r' : ''}`
      if (flag.startsWith('-')) return `complete -c corevelos -n '${condition}' -s ${flag.slice(1)}`
      return `complete -c corevelos -n '${condition}' -a '${flag}'`
    }),
  )
  .join('\n')}
`
  if (shell === 'powershell')
    return `Register-ArgumentCompleter -Native -CommandName corevelos -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @($commandAst.CommandElements | Where-Object {
    $_.Extent.EndOffset -le ($cursorPosition - $wordToComplete.Length)
  } | ForEach-Object { $_.Extent.Text })
  if ($words -contains '--') { return }
  $key = ''; $start = 1; $choices = @(); $valueFlags = @()
  if ($words.Count -gt 1 -and $words[1] -eq 'help') { $start = 2; $key = 'help' }
  if ($words.Count -gt $start) {
    if ($start -eq 2) { $key = 'help ' }
    $key += $words[$start]
    if (@('${branches.join("', '")}') -contains $words[$start] -and $words.Count -gt ($start + 1)) {
      $key += ' ' + $words[$start + 1]
    }
  }
  switch ($key) {
${entries.map(([key, flags]) => `    '${key}' { $choices = @('${flags.join("', '")}'); $valueFlags = @(${(values.get(key) ?? []).map((v) => "'" + v + "'").join(', ')}) }`).join('\n')}
  }
  if ($words.Count -gt 1 -and $valueFlags -contains $words[-1]) { return }
  $choices | Where-Object { $_.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`
  throw new CliError('completion requires bash, zsh, fish or powershell.')
}
