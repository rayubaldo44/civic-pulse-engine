// ── System theme — applies the OS dark-mode preference live to <html> by
// toggling the `dark` class that layout.css's `@custom-variant dark` keys on.
// Used by the landing page so it always tracks the OS, ignoring any manual
// override that the authenticated dashboard's ThemeToggle may have persisted.

export function applySystemTheme(): void {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle(
		'dark',
		window.matchMedia('(prefers-color-scheme: dark)').matches
	);
}

// Subscribes to OS theme changes; returns a cleanup so callers can stop
// following (e.g. when navigating to a page with a manual theme toggle).
export function watchSystemTheme(onChange: () => void = applySystemTheme): () => void {
	if (typeof window === 'undefined') return () => {};
	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	if (typeof mq.addEventListener === 'function') {
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}
	mq.addListener(onChange);
	return () => mq.removeListener(onChange);
}
