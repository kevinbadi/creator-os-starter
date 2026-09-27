#!/usr/bin/env node
/**
 * Knowledge Graph Re-Index
 * Wrapper script that calls the main indexer
 */

const { execSync } = require('child_process');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../../..');
const indexerPath = path.join(workspaceRoot, 'knowledge-graph', 'index.js');

console.log('╔════════════════════════════════════════════╗');
console.log('║     Knowledge Graph Re-Index               ║');
console.log('╚════════════════════════════════════════════╝\n');

try {
  execSync(`node "${indexerPath}"`, { 
    cwd: workspaceRoot,
    stdio: 'inherit' 
  });
  console.log('\n✅ Knowledge graph re-indexed successfully');
} catch (error) {
  console.error('\n❌ Re-index failed:', error.message);
  process.exit(1);
}
