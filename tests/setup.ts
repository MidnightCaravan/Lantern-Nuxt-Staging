import { defineEventHandler } from 'h3'

// Nuxt injects this auto-import at build time. Vitest imports handlers directly,
// so provide the same function before any handler module is evaluated.
;(globalThis as any).defineEventHandler = defineEventHandler
