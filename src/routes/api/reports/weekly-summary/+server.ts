import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const supabase = getServiceSupabase();
	const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

	const [{ data: rows }, { count: flaggedCount }] = await Promise.all([
		supabase
			.from('processed_content')
			.select('sentiment_label, topic_label')
			.gte('processed_at', since),
		supabase
			.from('flagged_claims')
			.select('*', { count: 'exact', head: true })
			.gte('created_at', since)
	]);

	const total = rows?.length ?? 0;
	const sentiment: Record<string, number> = {};
	const topics: Record<string, number> = {};

	for (const r of (rows ?? []) as Array<{ sentiment_label?: string; topic_label?: string }>) {
		const s = r.sentiment_label ?? 'Unknown';
		const t = r.topic_label ?? 'Unknown';
		sentiment[s] = (sentiment[s] ?? 0) + 1;
		topics[t] = (topics[t] ?? 0) + 1;
	}

	// Dynamic import avoids Vite bundling issues with pdfkit's CJS internals.
	const { default: PDFDocument } = await import('pdfkit');
	const doc = new PDFDocument({ margin: 50, size: 'A4' });
	const chunks: Uint8Array[] = [];
	doc.on('data', (c: Uint8Array) => chunks.push(c));

	// new Uint8Array(length) allocates a fresh ArrayBuffer (not ArrayBufferLike),
	// keeping the return type assignable to BodyInit.
	const pdf = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
		doc.on('end', () => {
			const total = chunks.reduce((s, c) => s + c.length, 0);
			const out = new Uint8Array(total);
			let off = 0;
			for (const c of chunks) {
				out.set(c, off);
				off += c.length;
			}
			resolve(out);
		});
		doc.on('error', reject);
		const generatedAt = new Date().toUTCString();
		const weekOf = new Date(Date.parse(since)).toDateString();

		doc
			.fontSize(22)
			.font('Helvetica-Bold')
			.text('CivicPulse — Weekly Summary Report', { align: 'center' })
			.moveDown(0.4)
			.fontSize(10)
			.font('Helvetica')
			.fillColor('#666666')
			.text(`Week of ${weekOf}   |   Generated ${generatedAt}`, { align: 'center' })
			.fillColor('#000000')
			.moveDown(1.5);

		// Overview
		doc.fontSize(14).font('Helvetica-Bold').text('Overview').moveDown(0.5);
		doc
			.fontSize(11)
			.font('Helvetica')
			.text(`Total Comments Analyzed : ${total}`)
			.text(`Flagged Claims          : ${flaggedCount ?? 0}`)
			.moveDown(1.2);

		// Sentiment
		doc.fontSize(14).font('Helvetica-Bold').text('Sentiment Breakdown').moveDown(0.5);
		for (const [k, v] of Object.entries(sentiment).sort((a, b) => b[1] - a[1])) {
			const pct = total ? ((v / total) * 100).toFixed(1) : '0.0';
			doc
				.fontSize(11)
				.font('Helvetica')
				.text(`  ${k.padEnd(12)} ${v}  (${pct}%)`);
		}
		doc.moveDown(1.2);

		// Topics
		doc.fontSize(14).font('Helvetica-Bold').text('Topic Breakdown').moveDown(0.5);
		for (const [k, v] of Object.entries(topics).sort((a, b) => b[1] - a[1])) {
			doc
				.fontSize(11)
				.font('Helvetica')
				.text(`  ${k.padEnd(20)} ${v}`);
		}

		doc.end();
	});

	return new Response(pdf, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="weekly-summary-${Date.now()}.pdf"`
		}
	});
};
