import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import IssueBoard from '$lib/components/IssueBoard.svelte';
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
		created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5m ago
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

const COLUMNS = ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed'];

describe('IssueBoard', () => {
	it('renders all five kanban columns in workflow order', () => {
		render(IssueBoard, { issues: [], onSelect: vi.fn() });

		const headers = screen.getAllByText(/^(Open|In Progress|Under Review|Resolved|Closed)$/);
		const labels = headers.map((h) => h.textContent);
		expect(labels.filter((l) => COLUMNS.includes(l ?? ''))).toEqual(COLUMNS);
	});

	it('shows an empty placeholder for columns without issues', () => {
		render(IssueBoard, { issues: [], onSelect: vi.fn() });

		expect(screen.getAllByText('No issues')).toHaveLength(COLUMNS.length);
	});

	it('routes each card into its matching status column', () => {
		const issues = [
			makeIssue({ id: 'a', title: 'Alpha', status: 'Open' }),
			makeIssue({ id: 'b', title: 'Beta', status: 'Under Review' }),
			makeIssue({ id: 'c', title: 'Gamma', status: 'Under Review' })
		];
		render(IssueBoard, { issues, onSelect: vi.fn() });

		for (const title of ['Alpha', 'Beta', 'Gamma']) {
			expect(screen.getByText(title)).toBeTruthy();
		}
	});

	it('fires onSelect with the clicked issue', async () => {
		const onSelect = vi.fn();
		const issue = makeIssue({ id: 'issue-9', title: 'Clickable card' });
		render(IssueBoard, { issues: [issue], onSelect });

		await fireEvent.click(screen.getByText('Clickable card'));

		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'issue-9' }));
	});

	it('shows an em-dash avatar for unassigned cards and initials for assigned ones', () => {
		const issues = [
			makeIssue({ id: 'a', assignee: { id: 's1', full_name: 'Ana Reyes' } }),
			makeIssue({ id: 'b', assignee: null })
		];
		render(IssueBoard, { issues, onSelect: vi.fn() });

		expect(screen.getByTitle('Ana Reyes').textContent).toBe('AR');
		expect(screen.getByTitle('Unassigned').textContent).toBe('—');
	});
});

describe('paged board columns', () => {
	it('shows global column totals and requests more without selecting a card', async () => {
		const onLoadMore = vi.fn();
		render(IssueBoard, { issues: [], onSelect: vi.fn(), totals: { Open: 125 }, onLoadMore });
		expect(screen.getByText('125')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Load more Open issues' }));
		expect(onLoadMore).toHaveBeenCalledWith('Open');
	});
});
