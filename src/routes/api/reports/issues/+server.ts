import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { csvCell } from '$lib/server/csv';

// ── GET /api/reports/issues ───────────────────────────────────────────────────
// CSV export: ID, Title, Topic, Priority, Status, Assigned Staff, Created At,
// Resolved At, and the number of status changes recorded for each issue.
export const GET: RequestHandler = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const supabase = getServiceSupabase();

	// Fetch issues with assignee profile; civic_issues not in generated types yet.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const civicQB = supabase.from('civic_issues') as any;
	const { data: issues } = await civicQB
		.select(
			`
			id, title, topic, priority, status,
			created_at, resolved_at,
			assignee:profiles!civic_issues_assigned_to_fkey ( full_name )
		`
		)
		.order('created_at', { ascending: false });

	// Fetch status-change counts grouped by issue_id — done server-side via the
	// get_status_change_counts RPC (GROUP BY in SQL) instead of pulling the
	// entire issue_status_logs table and counting in JS.
	const { data: logCounts } = await supabase.rpc('get_status_change_counts');

	// Build a lookup map: issue_id → count
	const countMap = new Map<string, number>();
	for (const row of (logCounts ?? []) as Array<{ issue_id: string; change_count: number }>) {
		countMap.set(row.issue_id, row.change_count);
	}

	const header = [
		'ID',
		'Title',
		'Topic',
		'Priority',
		'Status',
		'Assigned Staff',
		'Created At',
		'Resolved At',
		'Status Changes'
	];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rows = (issues ?? []).map((r: any) => [
		r.id,
		r.title,
		r.topic ?? '',
		r.priority,
		r.status,
		r.assignee?.full_name ?? '',
		r.created_at,
		r.resolved_at ?? '',
		countMap.get(r.id) ?? 0
	]);

	const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="issues-${Date.now()}.csv"`
		}
	});
};
