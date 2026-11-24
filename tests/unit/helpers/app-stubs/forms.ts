// SvelteKit's enhance action needs an active router; component tests exercise
// the form UI and call route actions separately.
export function enhance() {
	return { destroy() {} };
}
