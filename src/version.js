// @ts-check
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {string} */
export const VERSION = require('../package.json').version;
