import {
	ISSUE_STATUSES,
	emptyIssuePage,
	issueQueryParams,
	type IssueListQuery,
	type IssueColumns,
	type IssuePage
} from '$lib/types/paged-issues';
import type { IssueStatus } from '$lib/types/issues';
export interface IssuePageSeed {
	columns: IssueColumns | null;
	table: IssuePage | null;
	query: IssueListQuery;
	view: 'board' | 'table';
}

export function createIssuePages(initial: IssuePageSeed) {
	let columns = $state<IssueColumns | null>(initial.columns);
	let table = $state<IssuePage | null>(initial.table);
	let query = $state<IssueListQuery>(initial.query);
	let view = $state(initial.view);
	let loading = $state(false);
	let loadingColumns = $state<Partial<Record<IssueStatus, boolean>>>({});
	let error = $state<string | null>(null);
	let generation = 0;
	function seed(next: IssuePageSeed) {
		generation++;
		columns = next.columns;
		table = next.table;
		query = next.query;
		view = next.view;
		loading = false;
		loadingColumns = {};
		error = null;
	}
	async function read(next: IssueListQuery): Promise<IssuePage> {
		const response = await fetch(`/api/issues/paged?${issueQueryParams(next)}`);
		if (!response.ok) throw new Error('Unable to load issues. Try again.');
		return response.json();
	}
	async function loadMore(status: IssueStatus) {
		const current = columns?.[status];
		if (
			(query.statuses.length > 0 && !query.statuses.includes(status)) ||
			!current ||
			loadingColumns[status] ||
			loading ||
			current.items.length >= current.total
		)
			return;
		const version = generation;
		loadingColumns = { ...loadingColumns, [status]: true };
		error = null;
		try {
			const next = await read({ ...query, statuses: [status], page: current.page + 1 });
			if (version !== generation || !columns) return;
			const items = [...current.items, ...next.items];
			columns = {
				...columns,
				[status]: { ...next, items: [...new Map(items.map((i) => [i.id, i])).values()] }
			};
		} catch {
			if (version === generation) error = 'Unable to load more issues. Try again.';
		} finally {
			if (version === generation) loadingColumns = { ...loadingColumns, [status]: false };
		}
	}
	async function refresh() {
		// A mutation refresh must supersede an in-flight pre-mutation read.
		// Each caller awaits its own fresh request; older responses cannot apply.
		const version = ++generation;
		loading = true;
		loadingColumns = {};
		error = null;
		try {
			if (view === 'table') {
				const next = await read(query);
				if (version !== generation) return false;
				table = next;
			} else {
				const previous = columns;
				const entries = await Promise.all(
					ISSUE_STATUSES.map(async (status) => {
						if (query.statuses.length > 0 && !query.statuses.includes(status)) {
							return [
								status,
								emptyIssuePage(previous?.Open.counts ?? { open: 0, mine: 0, critical: 0 })
							] as const;
						}
						const count = previous?.[status].page ?? 1;
						const pages = await Promise.all(
							Array.from({ length: count }, (_, n) =>
								read({ ...query, statuses: [status], page: n + 1 })
							)
						);
						const last = pages[pages.length - 1];
						return [
							status,
							{
								...last,
								items: [...new Map(pages.flatMap((p) => p.items).map((i) => [i.id, i])).values()]
							}
						] as const;
					})
				);
				if (version !== generation) return false;
				const selectedCounts = entries.find(
					([status]) => query.statuses.length === 0 || query.statuses.includes(status)
				)?.[1].counts ?? { open: 0, mine: 0, critical: 0 };
				columns = Object.fromEntries(
					entries.map(([status, column]) => [
						status,
						query.statuses.length > 0 && !query.statuses.includes(status)
							? emptyIssuePage(selectedCounts)
							: column
					])
				) as IssueColumns;
			}
			return true;
		} catch {
			if (version === generation) error = 'Unable to refresh issues. Try again.';
			return false;
		} finally {
			if (version === generation) loading = false;
		}
	}
	return {
		get columns() {
			return columns;
		},
		get table() {
			return table;
		},
		get loading() {
			return loading;
		},
		get loadingColumns() {
			return loadingColumns;
		},
		get error() {
			return error;
		},
		get items() {
			return view === 'board' && columns
				? ISSUE_STATUSES.flatMap((s) => columns![s].items)
				: (table?.items ?? []);
		},
		get counts() {
			return table?.counts ?? columns?.Open.counts ?? { open: 0, mine: 0, critical: 0 };
		},
		seed,
		refresh,
		loadMore
	};
}
