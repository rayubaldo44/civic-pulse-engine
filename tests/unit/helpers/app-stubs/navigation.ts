// Stub for SvelteKit's $app/navigation virtual module.
// Vitest does not load the sveltekit() plugin, so this alias exists so
// components that import { goto } / { invalidate } can still be unit-tested.
export const goto = async (_href: string): Promise<void> => {};
export const invalidate = async (_dep: string): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const beforeNavigate = (_fn: unknown): void => {};
export const afterNavigate = (_fn: unknown): void => {};
export const preloadData = async (): Promise<void> => {};
export const preloadCode = async (): Promise<void> => {};
export const pushState = (): void => {};
export const replaceState = (): void => {};
