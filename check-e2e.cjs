/**
 * Check 3 things:
 * 1. Is .env file correctly written with TOPOMIND_E2E_WORKDIR?
 * 2. What does file-service.js initialize _fs_rootDir to?
 * 3. Is the preload script accessible at dist-electron/preload.mjs?
 */
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const projectRoot = path.join(__dirname)
const envFile = path.join(projectRoot, '.env')
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload.mjs')
const mainCompiled = path.join(projectRoot, 'dist-electron', 'main.js')

console.log('=== Diagnostic Check ===\n')

// 1. Check .env
console.log('1. Checking .env file:')
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8')
  console.log('   .env content:', JSON.stringify(content.trim()))
  const match = content.split('\n').find(l => l.startsWith('TOPOMIND_E2E_WORKDIR='))
  if (match) {
    console.log('   TOPOMIND_E2E_WORKDIR found:', match.split('=').slice(1).join('='))
  } else {
    console.log('   TOPOMIND_E2E_WORKDIR NOT FOUND in .env')
  }
} else {
  console.log('   .env does NOT exist')
}

// 2. Check dist-electron files
console.log('\n2. Checking dist-electron:')
if (fs.existsSync(preloadPath)) {
  console.log('   preload.mjs exists, size:', fs.statSync(preloadPath).size)
  const preloadContent = fs.readFileSync(preloadPath, 'utf8')
  console.log('   preload.mjs first 500 chars:', preloadContent.substring(0, 500))
} else {
  console.log('   preload.mjs NOT FOUND')
}

if (fs.existsSync(mainCompiled)) {
  console.log('   main.js compiled, size:', fs.statSync(mainCompiled).size)
  // Check if TOPOMIND_E2E_WORKDIR appears in compiled main.js
  const mainContent = fs.readFileSync(mainCompiled, 'utf8')
  if (mainContent.includes('TOPOMIND_E2E_WORKDIR')) {
    console.log('   main.js mentions TOPOMIND_E2E_WORKDIR: YES')
  } else {
    console.log('   main.js mentions TOPOMIND_E2E_WORKDIR: NO')
  }
} else {
  console.log('   main.js NOT FOUND')
}

// 3. Simulate what vite-plugin-electron does: spawn electron with env
console.log('\n3. Checking if TOPOMIND_E2E_WORKDIR reaches Electron main process:')
const testDir = path.join(fs.existsSync(envFile) ?
  (fs.readFileSync(envFile, 'utf8').split('\n').find(l => l.startsWith('TOPOMIND_E2E_WORKDIR=')) || '').split('=').slice(1).join('=') :
  '')
console.log('   Env var in current process:', process.env.TOPOMIND_E2E_WORKDIR || '(not set)')

// 4. Check the compiled main.js for what it reads at initialization time
console.log('\n4. Checking compiled main.js module initialization order:')
const mainContent = fs.readFileSync(mainCompiled, 'utf8')
// Find the file-service import position
const importMatch = mainContent.match(/from ['"]\.\/file-service['"]/)
console.log('   file-service import found at index:', importMatch ? mainContent.indexOf(importMatch[0]) : 'NOT FOUND')
// Find the E2E env loading code position
const e2eMatch = mainContent.match(/E2E_ENV_FILE/)
console.log('   E2E_ENV_FILE code found at index:', e2eMatch ? mainContent.indexOf(e2eMatch[0]) : 'NOT FOUND')
if (importMatch && e2eMatch) {
  const importIdx = mainContent.indexOf(importMatch[0])
  const e2eIdx = mainContent.indexOf(e2eMatch[0])
  console.log('   Order: file-service import', importIdx < e2eIdx ? 'BEFORE' : 'AFTER', 'E2E env loading')
}

console.log('\n=== Done ===')