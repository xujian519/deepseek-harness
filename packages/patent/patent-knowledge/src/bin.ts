#!/usr/bin/env node
/**
 * patent-knowledge-install — trims a source knowledge.db into the dsh
 * knowledge data directory. Usage:
 *   patent-knowledge-install [--from <source>] [--output <path>] [--no-compress-chunks] [--keep-embeddings] [--no-fts] [--skip-verify]
 * @module @deepseek-ai/dsh-patent-knowledge/bin
 */

import { parseArgs } from 'node:util'
import { installKnowledgeDb } from './install.ts'
import { errorMessage } from './shared/errors.ts'

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    output: { type: 'string' },
    'no-compress-chunks': { type: 'boolean', default: false },
    'keep-embeddings': { type: 'boolean', default: false },
    'no-fts': { type: 'boolean', default: false },
    'skip-verify': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false, short: 'h' },
  },
})

if (values.help) {
  console.log([
    'patent-knowledge-install — trim a source knowledge.db for the DeepSeek Harness.',
    '',
    'Usage: patent-knowledge-install [options]',
    '',
    'Options:',
    '  --from <path>             Source knowledge.db (default ~/.sati/knowledge/knowledge.db).',
    '  --output <path>           Output path (default ~/.dsh/knowledge/knowledge-lite.db).',
    '  --no-compress-chunks      Skip chunks.content gzip compression.',
    '  --keep-embeddings         Keep the embeddings tables (dropped by default).',
    '  --no-fts                  Drop the FTS5 indexes (degrades full-text to LIKE).',
    '  --skip-verify             Skip the post-trim component verification.',
    '  -h, --help                Print this help.',
  ].join('\n'))
  process.exit(0)
}

try {
  await installKnowledgeDb({
    sourceDbPath: values.from,
    output: values.output,
    compressChunks: !values['no-compress-chunks'],
    keepEmbeddings: values['keep-embeddings'],
    noFts: values['no-fts'],
    skipVerify: values['skip-verify'],
  })
} catch (error) {
  console.error(errorMessage(error))
  process.exit(1)
}
