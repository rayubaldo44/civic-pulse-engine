import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ locals: { safeGetSession, supabase } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	// RBAC — service role bypasses RLS but the route itself must enforce
	// admin access so non-admins can never download audit data.
	// Check 1: role from signed JWT claim (app_metadata is server-managed;
	// user_metadata is client-writable and must NEVER be trusted).
	if ((user.app_metadata?.role as string) !== 'admin') error(403, 'Forbidden');

	// Check 2: role from the database (independent of the JWT)
	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	if ((profile?.role as string) !== 'admin') error(403, 'Forbidden');

	const svcSupabase = getServiceSupabase();
	const { data } = await svcSupabase
		.from('audit_logs')
		.select(
			'id, action, actor_email, details, resource_type, resource_id, ip_address, user_agent, created_at'
		)
		.order('created_at', { ascending: false });

	// exceljs replaces the abandoned npm `xlsx` channel (prototype pollution +
	// ReDoS advisories with no fixed version). Heavy lib — dynamic import.
	// CJS package: Workbook only exists on the default export at runtime.
	const { default: ExcelJS } = await import('exceljs');
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Audit Logs');
	sheet.columns = [
		{ header: 'ID', key: 'id', width: 36 },
		{ header: 'Action', key: 'action', width: 28 },
		{ header: 'Actor Email', key: 'actor_email', width: 32 },
		{ header: 'Resource Type', key: 'resource_type', width: 16 },
		{ header: 'Resource ID', key: 'resource_id', width: 36 },
		{ header: 'IP Address', key: 'ip_address', width: 18 },
		{ header: 'User Agent', key: 'user_agent', width: 50 },
		{ header: 'Details', key: 'details', width: 64 },
		{ header: 'Created At', key: 'created_at', width: 30 }
	];
	for (const row of data ?? []) sheet.addRow(row);

	sheet.getRow(1).font = { bold: true };

	// ExcelJS.Buffer is a Node Buffer — copy into a plain Uint8Array so the
	// body satisfies BodyInit typing.
	const buf = await workbook.xlsx.writeBuffer();

	return new Response(new Uint8Array(buf as unknown as ArrayBuffer), {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="system-audit-${Date.now()}.xlsx"`
		}
	});
};
