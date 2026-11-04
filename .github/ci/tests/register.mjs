// Registers the resolver in loader.mjs, so the plugin's lib files can be imported by node's own
// test runner without a CloudTAK checkout (ops #410). Use: node --import ./register.mjs --test
import { registerHooks } from 'node:module'
import { resolve } from './loader.mjs'
registerHooks({ resolve })
