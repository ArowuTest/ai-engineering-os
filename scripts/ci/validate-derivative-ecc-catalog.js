#!/usr/bin/env node
'use strict';

const path = require('path');
const { createDocumentSpecs, main } = require('./catalog');

const root = path.join(__dirname, '../..');
const preservedReadmePath = path.join(root, 'docs', 'upstream', 'ECC-README.md');

try {
  main({
    documentSpecs: createDocumentSpecs({
      readmePath: preservedReadmePath,
    }),
  });
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
