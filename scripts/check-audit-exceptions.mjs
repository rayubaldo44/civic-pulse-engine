import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import config from '../svelte.config.js';

// GHSA-3r8g-jcqq-3p5j applies only to experimental remote functions.
// Remove the audit exception when upgrading to a patched SvelteKit release.
assert.notEqual(
	config.kit?.experimental?.remoteFunctions,
	true,
	'Remote functions invalidate the SvelteKit audit exception.'
);
assert.ok(
	!readdirSync('src', { recursive: true }).some((name) => /\.remote\.(?:js|ts)$/.test(name)),
	'Remote function files invalidate the SvelteKit audit exception.'
);
assert.ok(
	Date.now() < Date.UTC(2027, 1, 24),
	'The SvelteKit audit exception expired; reassess or upgrade the framework.'
);
console.log('SvelteKit audit exception: remote functions disabled; review due 2027-02-24.');
