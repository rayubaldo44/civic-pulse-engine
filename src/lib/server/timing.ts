export type RequestTimings = ReturnType<typeof createRequestTimings>;

/** Request-local durations only: never include query text, identities, or URLs. */
export function createRequestTimings(now: () => number = () => performance.now()) {
	const durations = new Map<string, number>();
	return {
		async measure<T>(name: string, run: () => T | PromiseLike<T>): Promise<T> {
			const started = now();
			try {
				return await run();
			} finally {
				durations.set(name, (durations.get(name) ?? 0) + Math.max(0, now() - started));
			}
		},
		header() {
			return [...durations]
				.map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
				.join(', ');
		}
	};
}

export function measureServer<T>(
	locals: App.Locals,
	name: string,
	run: () => T | PromiseLike<T>
): Promise<T> {
	return locals.timings ? locals.timings.measure(name, run) : Promise.resolve(run());
}
