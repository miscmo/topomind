import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

export default function globalTeardown() {
  // Clean up the temp work directory
  const marker = process.env.TOPOMIND_E2E_WORKDIR_MARKER
  if (marker && fs.existsSync(marker)) {
    fs.rmSync(marker, { recursive: true, force: true })
  }

  // Remove the .env file written by global-setup.ts (project root)
  const envFile = path.join(projectRoot, '.env')
  if (fs.existsSync(envFile)) {
    fs.rmSync(envFile)
  }
}