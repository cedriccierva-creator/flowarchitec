import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

let missing = false
function check(label, command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  const ok = result.status === 0
  const status = ok ? 'PASS' : result.error && result.error.code !== 'ENOENT' ? 'BLOCKED' : 'MISSING'
  const detail = ok ? result.stdout.trim().split('\n')[0] || 'available' : result.error?.message ?? result.stderr.trim()
  console.log(`${status} ${label}: ${detail}`)
  missing ||= !ok
}

console.log(`Node ${process.version}; required: >=22.12.0`)
const [major, minor] = process.versions.node.split('.').map(Number)
missing ||= major < 22 || (major === 22 && minor < 12)
if (process.env.npm_execpath) {
  check('npm', process.execPath, [process.env.npm_execpath, '--version'])
} else {
  check('npm', 'npm', ['--version'])
}
check('Rust compiler', 'rustc', ['--version'])
check('Cargo', 'cargo', ['--version'])
check('C compiler', 'cc', ['--version'])
for (const name of ['gtk+-3.0', 'webkit2gtk-4.1', 'javascriptcoregtk-4.1', 'libsoup-3.0', 'openssl', 'librsvg-2.0']) {
  check(name, 'pkg-config', ['--modversion', name])
}

const installed = existsSync(new URL('../node_modules/.bin/vite', import.meta.url))
console.log(`${installed ? 'PASS' : 'MISSING'} project dependencies (npm install)`)
missing ||= !installed
console.log(`Desktop: ${process.env.XDG_CURRENT_DESKTOP ?? 'unknown'}; session: ${process.env.XDG_SESSION_TYPE ?? 'unknown'}`)
console.log(`Wayland display: ${process.env.WAYLAND_DISPLAY ?? 'unset'}; X display: ${process.env.DISPLAY ?? 'unset'}`)
console.log('This check does not launch a window or verify canvas interactions.')
process.exitCode = missing ? 1 : 0
