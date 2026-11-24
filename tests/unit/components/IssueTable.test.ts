import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import IssueTable from '$lib/components/IssueTable.svelte';
import type { Issue } from '$lib/types/issues';

afterEach(cleanup);

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		id: overrides.id ?? 'issue-1',
		title: 'Broken streetlight',
		description: null,
		topic: 'Public Safety',
		priority: 'High',
		status: 'Open',
		created_at: '2026-08-01T00:00:00Z',
		updated_at: '2026-08-01T00:00:00Z',
		resolved_at: null,
		source_comment_id: null,
		source_flagged_claim_id: null,
		assigned_to: null,
		created_by: null,
		assignee: null,
		creator: null,
		...overrides
	};
}

type TableHandlers = {
	onSelect?: (issue: Issue) => void;
};

function renderTable(issues: Issue[], handlers: TableHandlers = {}) {
	const onSelect = vi.fn();
	const { container } = render(IssueTable, {
		issues,
		onSelect,
		...handlers
	});
	const rows = () => container.querySelectorAll('tbody tr');
	return {
		onSelect: handlers.onSelect ?? onSelect,
		rows,
		container
	};
}

describe('IssueTable', () => {
	it('renders one row per issue with newest first by default', () => {
		const issues = [
			makeIssue({ id: 'old', title: 'Old issue', created_at: '2026-08-01T00:00:00Z' }),
			makeIssue({ id: 'new', title: 'New issue', created_at: '2026-08-05T00:00:00Z' })
		];
		const { rows } = renderTable(issues);

		expect(rows()).toHaveLength(2);
		expect(rows()[0].textContent).toContain('New issue');
	});

	it('shows the empty-state row when nothing matches', () => {
		const { rows } = renderTable([]);

		expect(rows()).toHaveLength(1);
		expect(rows()[0].textContent).toContain('No issues match');
	});

	describe('filtering', () => {
		it('filters by the search input', async () => {
			const issues = [
				makeIssue({ id: '1', title: 'Flooded road' }),
				makeIssue({ id: '2', title: 'Broken streetlight' })
			];
			const { rows } = renderTable(issues);

			await fireEvent.input(screen.getByPlaceholderText(/Search by title/), {
				target: { value: 'flood' }
			});

			expect(rows()).toHaveLength(1);
			expect(rows()[0].textContent).toContain('Flooded road');
		});

		it('toggles a status pill to filter and back off', async () => {
			const issues = [
				makeIssue({ id: '1', status: 'Open' }),
				makeIssue({ id: '2', status: 'Closed' })
			];
			const { rows } = renderTable(issues);

			await fireEvent.click(screen.getByRole('button', { name: 'Open' }));
			expect(rows()).toHaveLength(1);
			expect(rows()[0].textContent).not.toContain('issue-2'.slice(0, 8));

			await fireEvent.click(screen.getByRole('button', { name: 'Open' }));
			expect(rows()).toHaveLength(2);
		});

		it('exposes Clear all once any filter is active', async () => {
			renderTable([makeIssue({})]);

			expect(screen.queryByText('Clear all')).toBeNull();

			await fireEvent.click(screen.getByRole('button', { name: 'Low' }));
			expect(screen.getByText('Clear all')).toBeTruthy();

			await fireEvent.click(screen.getByText('Clear all'));
			expect(screen.queryByText('Clear all')).toBeNull();
		});
	});

	describe('sorting', () => {
		const issues = [
			makeIssue({ id: '1', title: 'Charlie', priority: 'Medium' }),
			makeIssue({ id: '2', title: 'Alpha', priority: 'Critical' }),
			makeIssue({ id: '3', title: 'Bravo', priority: 'Low' })
		];

		function rowTitles(container: HTMLElement): string[] {
			return [...container.querySelectorAll('tbody tr td:nth-child(2)')].map(
				(td) => td.textContent ?? ''
			);
		}

		it('sorts titles ascending on first click and descending on second', async () => {
			const { container } = renderTable(issues);

			await fireEvent.click(screen.getByRole('button', { name: /Title/ }));
			expect(rowTitles(container).map((t) => t.trim())).toEqual(['Alpha', 'Bravo', 'Charlie']);

			await fireEvent.click(screen.getByRole('button', { name: /Title/ }));
			expect(rowTitles(container).map((t) => t.trim())).toEqual(['Charlie', 'Bravo', 'Alpha']);
		});

		it('sorts priorities by severity, not alphabetically', async () => {
			const { container } = renderTable(issues);

			await fireEvent.click(screen.getByRole('button', { name: /Priority/ }));

			expect(rowTitles(container).map((t) => t.trim())).toEqual(['Alpha', 'Charlie', 'Bravo']);
		});
	});

	describe('row actions', () => {
		it('fires onSelect from the View button', async () => {
			const { onSelect } = renderTable([makeIssue({ id: 'view-me' })]);

			await fireEvent.click(screen.getByRole('button', { name: 'View' }));

			expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'view-me' }));
		});

		it('does not allow direct resolution from the table', async () => {
			renderTable([
				makeIssue({ id: 'open-one', status: 'Open' }),
				makeIssue({ id: 'review-one', status: 'Under Review' })
			]);

			expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
		});
	});
});

describe('server paged table', () => {
	it('requests global filters without filtering the currently loaded batch', async () => {
		const onQueryChange = vi.fn();
		render(IssueTable, {
			issues: [makeIssue({ title: 'Current page' })],
			onSelect: vi.fn(),
			serverQuery: {
				page: 1,
				statuses: [],
				priorities: [],
				topics: [],
				q: '',
				sort: 'created_at',
				direction: 'desc',
				scope: 'all'
			},
			onQueryChange
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Low' }));
		await vi.waitFor(() =>
			expect(onQueryChange).toHaveBeenCalledWith(
				expect.objectContaining({ priorities: ['Low'], page: 1 })
			)
		);
		expect(screen.getByText('Current page')).toBeTruthy();
	});
});
