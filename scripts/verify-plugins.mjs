import { spawn } from 'node:child_process'

const scripts = [
  'verify:plugins:static',
  'verify:plugins:boundaries',
  'verify:plugins:runtime',
]

function getNpmCommand() {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath],
    }
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [],
  }
}

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const npmCommand = getNpmCommand()
    const child = spawn(npmCommand.command, [...npmCommand.args, 'run', scriptName], {
      stdio: 'inherit',
      shell: false,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`"${scriptName}" exited with code ${code ?? 'unknown'}`))
    })
  })
}

for (const scriptName of scripts) {
  await runScript(scriptName)
}
