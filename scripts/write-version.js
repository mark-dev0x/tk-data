import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

// Get git commit hash
let commitHash = 'unknown'
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  console.warn('⚠️ Unable to get git commit hash')
}

// Format the current date in Asia/Manila timezone
const manilaTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
}).format(new Date())

// Build output text
const versionText = `Version: ${commitHash}\nBuild time: ${manilaTime}`

// Write to public/version.txt
writeFileSync('public/version.txt', versionText)
