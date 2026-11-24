export const PAGE_SIZE = 25;

export interface PageResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}

export function getPagination(params: URLSearchParams) {
	const raw = params.get('page') ?? '1';
	const value = /^\d+$/.test(raw) ? Number(raw) : 1;
	const page =
		Number.isSafeInteger(value * PAGE_SIZE) && value > 0 && value <= 2_147_483_647 ? value : 1;
	return { page, pageSize: PAGE_SIZE, from: (page - 1) * PAGE_SIZE, to: page * PAGE_SIZE - 1 };
}

export function pageHref(url: URL, page: number): string {
	const next = new URL(url);
	next.searchParams.set('page', String(page));
	return `${next.pathname}${next.search}`;
}
