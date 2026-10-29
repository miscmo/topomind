// Windows build wrapper.
//
// Problems this works around:
//
// 1) `release/win-unpacked/resources/app.asar` can stay locked by Windows
//    Defender real-time protection / Search Indexer long after a build
//    finishes. On the next `electron-builder --win` run, the packer tries to
//    unlink that still-locked `app.asar` and fails with
//      EBUSY: resource busy or locked, unlink '.../release/win-unpacked/resources/app.asar'
//    Fix: always emit into a fresh timestamped output directory
//    (`release/build-<timestamp>/`) so electron-builder never has to unlink the
//    previously-locked `win-unpacked`.
//
// 2) During electron unpack, Windows Defender (or the Search Indexer) starts
//    scanning the freshly-extracted electron binaries (.exe/.dll/.pak) inside
//    `win-unpacked.tmp` *immediately*. electron-builder then tries to rename
//    that directory to `win-unpacked` and fails with
//      EPERM: operation not permitted, rename '.../win-unpacked.tmp' -> '.../win-unpacked'
//    because a file inside is still held open by the AV scanner.
//    Fix: retry the whole pack with a delay so the AV scanner releases its
//    handles before the next attempt. Each retry uses a NEW timestamped dir,
//    so it is a fresh extraction rather than fighting the same lock. For a
//    permanent fix, exclude the project dir from Windows Defender real-time
//    protection (see README / build notes).

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 8000

function freshStamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19) // YYYY-MM-DD_HH-MM-SS
}

// Best-effort cleanup of previous timestamped build dirs so they don't pile up.
// Any dir that can't be removed (still locked by AV / Explorer) is left alone
// instead of failing the build. The in-progress attempt's own dir is preserved.
function cleanupOldBuildDirs(currentStamp) {
  const release = 'release'
  if (!existsSync(release)) return
  for (const name of readdirSync(release)) {
    if (name.startsWith('build-') && name !== `build-${currentStamp}`) {
      try {
        rmSync(join(release, name), { recursive: true, force: true })
      } catch {
        // locked or in use — ignore, it will be cleaned up after a reboot
      }
    }
  }
}

function runOnce(outDir) {
  return new Promise((resolve) => {
    const args = ['--win', `--config.directories.output=${outDir}`, ...process.argv.slice(2)]
    console.log(`[build-win] output -> ${outDir}`)
    const child = spawn('electron-builder', args, { stdio: 'inherit', shell: true })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const stamp = freshStamp()
    const outDir = join('release', `build-${stamp}`)
    cleanupOldBuildDirs(stamp)
    console.log(`[build-win] attempt ${attempt}/${MAX_ATTEMPTS}`)
    const code = await runOnce(outDir)
    if (code === 0) {
      console.log('[build-win] build succeeded')
      process.exit(0)
    }
    console.error(`[build-win] attempt ${attempt} failed with exit code ${code}`)
    if (attempt < MAX_ATTEMPTS) {
      console.log(
        `[build-win] waiting ${RETRY_DELAY_MS}ms for AV/indexer handles to release before retry...`
      )
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
  console.error('[build-win] all attempts failed')
  process.exit(1)
}

main()
