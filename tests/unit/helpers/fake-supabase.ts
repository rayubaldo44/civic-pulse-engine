// Minimal fluent stand-in for the Supabase query builder used by the Issue
// Tracker server code. Records every chain call so tests can assert exactly
// what was requested, and resolves results either from a FIFO queue or a
// caller-supplied matcher.
//
// Supported surface (everything the endpoints under test use):
//   from(t).select(c) · .insert(row) · .update(row)
//   .eq(col,v) · .ilike(col,v) · .in(col,vals) · .not(col,op,v) · .gte(col,v)
//   .order(col,{ascending}) · .limit(n) · .rpc(name,args)
//   await · .single() · .maybeSingle()

export interface FakeFilter {
	type: 'eq' | 'ilike' | 'in' | 'not' | 'gte';
	column: string;
	value: unknown;
	/** Operator string for `not` filters (e.g. "is"). */
	operator?: string;
}

export interface RecordedCall {
	table: string;
	verb: 'select' | 'insert' | 'update' | 'rpc';
	select?: string;
	filters: FakeFilter[];
	order: { column: string; options?: { ascending?: boolean } } | null;
	limit: number | null;
	payload: Record<string, unknown> | Record<string, unknown>[] | null;
	terminal: 'await' | 'single' | 'maybeSingle' | 'rpc';
	rpc?: { name: string; args: Record<string, unknown> };
}

export interface FakeResult {
	data?: unknown;
	error?: { message: string; code?: string } | null;
	/** PostgREST exact-count value — set via .update(.., { count: 'exact' }). */
	count?: number | null;
}

export type ResultMatcher = (call: RecordedCall) => FakeResult;

class FakeQueryBuilder {
	private call: RecordedCall;
	private built = false;
	private cached: FakeResult | null = null;

	constructor(
		private readonly resolve: () => FakeResult,
		private readonly onBuilt: (call: RecordedCall) => void,
		table: string
	) {
		this.call = {
			table,
			verb: 'select',
			filters: [],
			order: null,
			limit: null,
			payload: null,
			terminal: 'await'
		};
	}

	select(columns: string): this {
		this.call.select = columns;
		return this;
	}

	insert(payload: Record<string, unknown> | Record<string, unknown>[], options?: unknown): this {
		this.call.verb = 'insert';
		this.call.payload = payload;
		void options;
		return this;
	}

	update(payload: Record<string, unknown>): this {
		this.call.verb = 'update';
		this.call.payload = payload;
		return this;
	}

	eq(column: string, value: unknown): this {
		this.call.filters.push({ type: 'eq', column, value });
		return this;
	}

	ilike(column: string, pattern: string): this {
		this.call.filters.push({ type: 'ilike', column, value: pattern });
		return this;
	}

	in(column: string, values: unknown[]): this {
		this.call.filters.push({ type: 'in', column, value: values });
		return this;
	}

	not(column: string, operator: string, value: unknown): this {
		this.call.filters.push({ type: 'not', column, operator, value });
		return this;
	}

	gt(column: string, value: unknown): this {
		this.call.filters.push({ type: 'gte', column, value });
		return this;
	}

	gte(column: string, value: unknown): this {
		this.call.filters.push({ type: 'gte', column, value });
		return this;
	}

	order(column: string, options?: { ascending?: boolean }): this {
		this.call.order = { column, options };
		return this;
	}

	limit(count: number): this {
		this.call.limit = count;
		return this;
	}

	single(): FakeResult {
		this.call.terminal = 'single';
		return this.finish();
	}

	maybeSingle(): FakeResult {
		this.call.terminal = 'maybeSingle';
		return this.finish();
	}

	then<T>(onFulfilled?: (value: FakeResult) => T, onRejected?: (reason: unknown) => T): Promise<T> {
		return Promise.resolve(this.finish()).then(onFulfilled, onRejected);
	}

	private finish(): FakeResult {
		if (!this.built) {
			this.built = true;
			this.onBuilt(this.call);
			this.cached = this.resolve();
		}
		return this.cached as FakeResult;
	}
}

export interface FakeSupabase {
	from: (table: string) => FakeQueryBuilder;
	/** RPC invocation — resolves to a plain { data, error } result. */
	rpc: (name: string, args: Record<string, unknown>) => Promise<FakeResult>;
	calls: RecordedCall[];
	lastCall: () => RecordedCall;
	callsFor: (table: string) => RecordedCall[];
}

// `queue` serves results in FIFO order (one per executed query); `match`
// overrides the queue when supplied. Every executed query is recorded in
// `calls` regardless of how its result was produced.
export function createFakeSupabase(
	config: { queue?: FakeResult[]; match?: ResultMatcher } = {}
): FakeSupabase {
	const calls: RecordedCall[] = [];
	const queue = config.queue ? [...config.queue] : [];

	function nextResult(call: RecordedCall): FakeResult {
		if (config.match) return config.match(call);
		const next = queue.shift();
		if (!next) throw new Error(`fake-supabase: no queued result for ${call.table}`);
		return next;
	}

	function lastCall(): RecordedCall {
		const last = calls[calls.length - 1];
		if (!last) throw new Error('fake-supabase: no recorded calls');
		return last;
	}

	return {
		from: (table: string): FakeQueryBuilder => {
			const builder: FakeQueryBuilder = new FakeQueryBuilder(
				() => nextResult(lastCall()),
				(call) => calls.push(call),
				table
			);
			return builder;
		},
		rpc: (name, args): any => {
			const call: RecordedCall = {
				table: name,
				verb: 'rpc',
				filters: [],
				order: null,
				limit: null,
				payload: null,
				terminal: 'rpc',
				rpc: { name, args }
			};
			calls.push(call);
			const result = nextResult(call);
			return {
				data: result.data,
				error: result.error,
				count: result.count,
				single: () => result,
				maybeSingle: () => result,
				order: () => ({ data: result.data, error: result.error }),
				limit: () => ({ data: result.data, error: result.error }),
				neq: () => ({ data: result.data, error: result.error }),
				lt: () => ({ data: result.data, error: result.error }),
				gte: () => ({ data: result.data, error: result.error }),
				lte: () => ({ data: result.data, error: result.error }),
				asc: () => ({ data: result.data, error: result.error }),
				desc: () => ({ data: result.data, error: result.error }),
				/**
				 * The supabase-js RPC result is a thenable that resolves to the
				 * { data, error } payload. Implementing it as a Promise lets
				 * `await supabase.rpc(...).maybeSingle()` work without a wrapper.
				 */
				then: (onFulfilled?: (value: FakeResult) => any, onRejected?: (reason: unknown) => any) =>
					Promise.resolve(result).then(onFulfilled, onRejected)
			};
		},
		calls,
		lastCall,
		callsFor: (table: string) => calls.filter((c) => c.table === table)
	};
}
