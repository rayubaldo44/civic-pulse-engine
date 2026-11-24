// src/lib/server/notify.ts
// Transactional email via the Resend API: issue-tracker assignment/status
// changes, plus topic-trend alerts.
//
// Env vars (all optional — without RESEND_API_KEY every send is a silent
// dev no-op so local/dev environments keep working):
//   RESEND_API_KEY  — API key from resend.com
//   MAIL_FROM       — verified "From" header, e.g. "Civic Pulse <no-reply@domain>"
//   APP_ORIGIN      — absolute origin used in email links
//                     (falls back to VERCEL_URL, then localhost:5173)
//
// All senders swallow their own errors and log them — a failed notification
// must never fail the API request that triggered it.

import { env } from '$env/dynamic/private';
import { getServiceSupabase } from '$lib/server/supabase';
import { getPrefs } from '$lib/server/notifications';
import { isChannelEnabled } from '$lib/types/notifications';
import type { IssueStatus } from '$lib/types/issues';

export interface IssueNotification {
	issueId: string;
	title: string;
	priority?: string;
	toStatus?: IssueStatus;
	assigneeId: string;
	actorId: string;
}

async function resolveUser(
	userId: string
): Promise<{ email: string | null; fullName: string | null }> {
	const supabase = getServiceSupabase();
	const [profileRes, authRes] = await Promise.all([
		supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
		supabase.auth.admin.getUserById(userId)
	]);
	return {
		email: authRes.data?.user?.email ?? null,
		fullName: (profileRes.data as { full_name: string | null } | null)?.full_name ?? null
	};
}

function appOrigin(): string {
	return (
		env.APP_ORIGIN ??
		(env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined) ??
		'http://localhost:5173'
	);
}

async function resendSend(to: string, subject: string, html: string): Promise<void> {
	const key = env.RESEND_API_KEY;
	if (!key) return; // dev no-op

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from: env.MAIL_FROM || 'Civic Pulse <onboarding@resend.dev>',
			to,
			subject,
			html
		})
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
	}
}

function issueLink(): string {
	return `${appOrigin()}/Authenticated/issues`;
}

function shell(bodyHtml: string): string {
	return `
	<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
		<div style="background:#1e293b;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
			<strong>Civic Pulse · Issue Tracker</strong>
		</div>
		<div style="border:1px solid #e2e8f0;border-top:none;padding:20px;border-radius:0 0 8px 8px">
			${bodyHtml}
		</div>
	</div>`;
}

function ctaButton(label = 'Open Issue Tracker'): string {
	return `
	<a href="${issueLink()}"
		style="display:inline-block;background:#2563eb;color:#fff;padding:8px 14px;
		border-radius:6px;text-decoration:none;font-size:13px">
		${label}
	</a>`;
}

async function deliver(
	input: IssueNotification,
	buildSubject: () => string,
	buildBody: (actorName: string) => string
): Promise<void> {
	try {
		if (!input.assigneeId || input.assigneeId === input.actorId) return;

		const [recipient, actor] = await Promise.all([
			resolveUser(input.assigneeId),
			resolveUser(input.actorId)
		]);
		if (!recipient.email) return;

		const actorName = actor.fullName ?? 'A staff member';
		await resendSend(recipient.email, buildSubject(), shell(buildBody(actorName)));
	} catch (err) {
		console.error('[notify] issue email failed:', err);
	}
}

export function notifyIssueAssigned(input: IssueNotification): Promise<void> {
	return deliver(
		input,
		() => `[Civic Pulse] Issue assigned to you: ${input.title}`,
		(actorName) => `
			<p style="margin:0 0 12px">Hi — <strong>${actorName}</strong> assigned an issue to you:</p>
			<p style="margin:0 0 4px"><strong>${input.title}</strong></p>
			<p style="margin:0 0 12px;color:#64748b;font-size:13px">
				Priority: ${input.priority ?? 'Medium'}
			</p>
			${ctaButton()}
		`
	);
}

export function notifyIssueStatusChanged(input: IssueNotification): Promise<void> {
	return deliver(
		input,
		() => `[Civic Pulse] ${input.title} → ${input.toStatus}`,
		(actorName) => `
			<p style="margin:0 0 12px">
				Hi — <strong>${actorName}</strong> moved your issue to
				<strong>${input.toStatus}</strong>:
			</p>
			<p style="margin:0 0 4px"><strong>${input.title}</strong></p>
			<p style="margin:0 0 12px;color:#64748b;font-size:13px">
				Priority: ${input.priority ?? 'Medium'}
			</p>
			${ctaButton()}
		`
	);
}

export function notifyIssuePeerReviewAssigned(input: IssueNotification): Promise<void> {
	return deliverPeerReview(
		input,
		() => `[Civic Pulse] Peer review assigned: ${input.title}`,
		() => `
			<p style="margin:0 0 12px">An independent review is waiting for you:</p>
			<p style="margin:0 0 4px"><strong>${escapeHtml(input.title)}</strong></p>
			<p style="margin:0 0 12px;color:#64748b;font-size:13px">Submit your review within 72 hours.</p>
			${ctaButton('Review resolution')}
		`
	);
}

export function notifyIssueReviewReminder(input: IssueNotification): Promise<void> {
	return deliverPeerReview(
		input,
		() => `[Civic Pulse] Peer review overdue: ${input.title}`,
		() => `
			<p style="margin:0 0 12px">Your peer review is overdue:</p>
			<p style="margin:0 0 12px"><strong>${escapeHtml(input.title)}</strong></p>
			${ctaButton('Complete review')}
		`
	);
}

export function notifyIssueReviewOutcome(input: IssueNotification): Promise<void> {
	return deliverPeerReview(
		input,
		() => `[Civic Pulse] ${input.title} → ${input.toStatus}`,
		() => `
			<p style="margin:0 0 12px">The peer-review round is complete.</p>
			<p style="margin:0 0 4px"><strong>${escapeHtml(input.title)}</strong></p>
			<p style="margin:0 0 12px;color:#64748b;font-size:13px">Status: ${input.toStatus}</p>
			${ctaButton()}
		`
	);
}

async function deliverPeerReview(
	input: IssueNotification,
	buildSubject: () => string,
	buildBody: (actorName: string) => string
): Promise<void> {
	const prefs = await getPrefs(input.assigneeId);
	if (!isChannelEnabled(prefs, 'issue_peer_review', 'email')) return;
	return deliver(input, buildSubject, buildBody);
}

// ── Trend alerts ────────────────────────────────────────────────────────────

export interface TrendAlertEmail {
	userId: string;
	title: string;
	body: string;
	/** App-relative path; prefixed with APP_ORIGIN to form an absolute link. */
	href: string;
	severity: 'info' | 'warning' | 'critical';
}

/**
 * Email a topic-trend alert. Unlike the issue emails this has no actor — the
 * "sender" is the scoring engine, not a person — so the copy is written
 * second-person and the subject carries the topic rather than a name.
 *
 * The recipient's email preference is checked by the caller
 * ($lib/server/trend-evaluator.ts) so this stays a pure send.
 */
export async function notifyTrendAlertEmail(input: TrendAlertEmail): Promise<void> {
	try {
		const recipient = await resolveUser(input.userId);
		if (!recipient.email) return;

		const accent =
			input.severity === 'critical'
				? '#b91c1c'
				: input.severity === 'warning'
					? '#b45309'
					: '#1d4ed8';

		await resendSend(
			recipient.email,
			`[Civic Pulse] ${input.title}`,
			shell(`
				<p style="margin:0 0 12px">${escapeHtml(input.body)}</p>
				<p style="margin:0 0 16px">
					<a href="${appOrigin()}${input.href}"
						style="display:inline-block;background:${accent};color:#fff;padding:8px 14px;
						border-radius:6px;text-decoration:none;font-size:13px">
						View the dashboard
					</a>
				</p>
				<p style="margin:0;color:#94a3b8;font-size:12px">
					You're receiving this because trend alerts are enabled for your account.
					Change that in Settings → Notifications.
				</p>
			`)
		);
	} catch (err) {
		console.error('[notify] trend alert email failed:', err);
	}
}

/** Escape interpolated values before they reach an HTML email body. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
