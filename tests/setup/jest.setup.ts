/**
 * @file Jest setup file to load environment variables before tests
 * @description Loads .env.test if present, otherwise falls back to .env
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

/**
 * Load environment variables from .env.test or .env before running tests
 */
;(() => {
  const rootDir = process.cwd()
  const envTestPath = path.join(rootDir, '.env.test')
  const envPath = path.join(rootDir, '.env')

  if (fs.existsSync(envTestPath)) {
    dotenv.config({ path: envTestPath })
  } else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  } else {
    dotenv.config()
  }
})()
