// Windows build wrapper.
//
// Problem this works around: `release/win-unpacked/resources/app.asar` can stay
// locked by Windows Defender real-time protection / Search Indexer long after a
// build finishes. On the next `electron-builder --win` run, the packer tries to
// unlink that still-locked `app.asar` and fails with
//   EBUSY: resource busy or locked, unlink '.../release/win-unpacked/resources/app.asar'
//
// Fix: always emit into a fresh timestamped output directory
// (`release/build-<timestamp>/`) so electron-builder never has to unlink the
// previously-locked `win-unpacked`. The stale locked dir can be deleted after a
// reboot / once the AV handle is released.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19) // YYYY-MM-DD_HH-MM-SS

const outDir = join('release', `build-${stamp}`)

// Best-effort cleanup of previous timestamped build dirs so they don't pile up.
// Any dir that can't be removed (still locked by AV / Explorer) is left alone
// instead of failing the build.
const release = 'release'
if (existsSync(release)) {
  for (const name of readdirSync(release)) {
    if (name.startsWith('build-') && name !== `build-${stamp}`) {
      try {
        rmSync(join(release, name), { recursive: true, force: true })
      } catch {
        // locked or in use — ignore, it will be cleaned up after a reboot
      }
    }
  }
}

const args = ['--win', `--config.directories.output=${outDir}`, ...process.argv.slice(2)]

console.log(`[build-win] output -> ${outDir}`)

const child = spawn('electron-builder', args, { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 1))
