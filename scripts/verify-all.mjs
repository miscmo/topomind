/**
 * 一键门禁总入口。
 *
 * 为什么不用 package.json 里的 `"a && b && c"`：Windows 上 npm 脚本由
 * PowerShell 5.1 / cmd 执行，`&&` 在 PowerShell 5.1 不是有效语句分隔符，
 * 会直接 ParserError。改成 Node 顺序 spawn，跨平台行为一致，且任一步失败即停。
 */
import { spawnSync } from 'node:child_process'

const STEPS = [
  ['npm', ['run', 'verify:design']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'verify:critical']],
  ['npm', ['run', 'verify:plugins']],
  ['npm', ['run', 'verify:logging']],
  ['npm', ['run', 'verify:lint:baseline']],
]

for (const [command, args] of STEPS) {
  console.log(`\n=== ${command} ${args.join(' ')} ===`)
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    console.error(`STEP_FAILED: ${command} ${args.join(' ')} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}
console.log('\nALL_VERIFY_PASSED')
