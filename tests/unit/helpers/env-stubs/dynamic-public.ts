// Vitest stand-in for SvelteKit's $env/dynamic/public virtual module.
// Tests vi.mock this module's factory when they need specific values.
export const env: Record<string, string | undefined> = {};
