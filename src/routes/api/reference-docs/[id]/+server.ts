import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals: { safeGetSession, supabase }, params }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');
	const { data, error } = await supabase
		.from('lgu_documents')
		.select('id, title, document_type, content, is_active, uploaded_at')
		.eq('id', params.id)
		.maybeSingle();
	if (error) {
		if (error.code === '22P02')
			return json({ error: 'Document not found.' }, { status: 404, headers });
		console.error('[reference-docs] detail query failed');
		return json(
			{ error: 'Could not load this document. Please try again.' },
			{ status: 500, headers }
		);
	}
	if (!data) return json({ error: 'Document not found.' }, { status: 404, headers });
	return json(data, { headers });
};
