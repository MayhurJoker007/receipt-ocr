#!/usr/bin/env node
// node src/cli.js receipt.jpg [--engine tesseract|vision] [--text]

import { parseReceipt } from './parse.js';
import { tesseractText, visionText } from './ocr.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const engine = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : 'tesseract';

if (!file) {
  console.error('usage: node src/cli.js <image> [--engine tesseract|vision] [--text]');
  process.exit(1);
}

const text = engine === 'vision' ? await visionText(file) : await tesseractText(file);
if (args.includes('--text')) {
  console.log(text);
  console.log('---');
}
console.log(JSON.stringify(parseReceipt(text), null, 2));
