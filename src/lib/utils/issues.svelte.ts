import type { Issue, IssueDetail, Profile } from '$lib/types/issues';

export function createIssueState(seedIssues: Issue[] = [], seedStaff: Profile[] = []) {
	let issues = $state<Issue[]>(seedIssues);
	let staff = $state<Profile[]>(seedStaff);
	let slideDetail = $state<IssueDetail | null>(null);
	let slideLoading = $state(false);
	let slideOpen = $derived(slideDetail !== null || slideLoading);
	let refreshing = $state(false);
	let detailRequest = 0;

	async function openIssue(issue: Issue) {
		const request = ++detailRequest;
		slideLoading = true;
		slideDetail = null;
		try {
			const res = await fetch(`/api/issues/${issue.id}`);
			if (res.ok) {
				const detail = (await res.json()) as IssueDetail;
				if (request === detailRequest) slideDetail = detail;
			}
		} catch (err) {
			console.error('[issues] failed to load detail:', err);
		} finally {
			if (request === detailRequest) slideLoading = false;
		}
	}

	function closeSlideOver() {
		detailRequest++;
		slideDetail = null;
		slideLoading = false;
	}

	function handleUpdate(updated: Partial<Issue> & { id: string }) {
		issues = issues.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
		if (slideDetail?.id === updated.id) {
			slideDetail = { ...slideDetail, ...updated } as IssueDetail;
		}
	}

	// Silent refetch of the open slide-over issue — syncs status history,
	// comments, and joined fields without toggling the loading skeleton
	async function refreshDetail() {
		const id = slideDetail?.id;
		if (!id) return;
		try {
			const res = await fetch(`/api/issues/${id}`);
			if (!res.ok) return;
			const detail = (await res.json()) as IssueDetail;
			if (slideDetail?.id !== id) return; // closed or switched meanwhile
			slideDetail = detail;
			issues = issues.map((i) => (i.id === id ? { ...i, ...detail } : i));
		} catch (err) {
			console.error('[issues] failed to refresh detail:', err);
		}
	}

	// Refetch the issue list (and staff) from the API — replaces state wholesale.
	// Used by the manual refresh button and the dashboard widget poll.
	async function refresh(): Promise<boolean> {
		if (refreshing) return false;
		refreshing = true;
		try {
			const [issuesRes, staffRes] = await Promise.all([fetch('/api/issues'), fetch('/api/staff')]);
			let ok = true;
			if (issuesRes.ok) issues = (await issuesRes.json()) as Issue[];
			else ok = false;
			if (staffRes.ok) staff = (await staffRes.json()) as Profile[];
			return ok;
		} catch {
			return false;
		} finally {
			refreshing = false;
		}
	}

	return {
		get issues() {
			return issues;
		},
		set issues(v) {
			issues = v;
		},
		get staff() {
			return staff;
		},
		set staff(v) {
			staff = v;
		},
		get slideDetail() {
			return slideDetail;
		},
		get slideLoading() {
			return slideLoading;
		},
		get slideOpen() {
			return slideOpen;
		},
		get refreshing() {
			return refreshing;
		},
		openIssue,
		closeSlideOver,
		handleUpdate,
		refreshDetail,
		refresh
	};
}
