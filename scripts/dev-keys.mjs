#!/usr/bin/env node
/**
 * Generate a 32-byte hex key for local dev. NOT for production.
 * Run: node scripts/dev-keys.mjs
 */
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");
console.log("VAULT_MASTER_KEY=" + key);
console.log("Add the line above to your .dev.vars file.");