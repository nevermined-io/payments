/**
 * API Keys Pool Helper
 * Allows assignment of a unique set of API Keys per test suite.
 * Configure API Keys in your environment as: SUBSCRIBER_API_KEY_1, BUILDER_API_KEY_1, ...
 *
 * @module tests/utils/apiKeysPool
 */

interface TestApiKeys {
  subscriber: string
  builder: string
}

// List of unique key sets for testing
export const apiKeysPool: TestApiKeys[] = [
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_1 || '',
    builder: process.env.BUILDER_API_KEY_1 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_2 || '',
    builder: process.env.BUILDER_API_KEY_2 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_1 || '',
    builder: process.env.BUILDER_API_KEY_1 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_3 || '',
    builder: process.env.BUILDER_API_KEY_3 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_4 || '',
    builder: process.env.BUILDER_API_KEY_4 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_5 || '',
    builder: process.env.BUILDER_API_KEY_5 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_6 || '',
    builder: process.env.BUILDER_API_KEY_6 || '',
  },
  {
    subscriber: process.env.SUBSCRIBER_API_KEY_7 || '',
    builder: process.env.BUILDER_API_KEY_7 || '',
  },
]

/**
 * Returns the set of API keys for a specific test suite or pool.
 * @param {number} suiteIndex - Suite index (0-based)
 * @returns {TestApiKeys}
 * @throws If not enough keys are configured
 */
export function getTestApiKeys(suiteIndex: number): TestApiKeys {
  if (suiteIndex >= apiKeysPool.length) {
    throw new Error(`Not enough API Keys configured for suite index ${suiteIndex}`)
  }
  const keys = apiKeysPool[suiteIndex]
  if (!keys.subscriber || !keys.builder) {
    throw new Error(`Missing API keys for suite index ${suiteIndex}`)
  }
  return keys
}

/**
 * Stable string hash (djb2) to map file paths deterministically to a pool index.
 * @param {string} input
 * @returns {number} non-negative integer
 */
function hashString(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + charCode
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Returns API keys deterministically for a given test file path.
 * This avoids manual indexing and keeps suite-to-keys mapping stable across runs.
 * @param {string} filePath - Typically pass __filename from the test file
 * @returns {TestApiKeys}
 */
export function getApiKeysForFile(filePath: string): TestApiKeys {
  if (!apiKeysPool.length) {
    throw new Error('No API keys configured in apiKeysPool')
  }
  const index = hashString(filePath) % apiKeysPool.length
  console.log(`Using API keys for file: ${filePath} (index: ${index})`)
  return getTestApiKeys(index)
}
