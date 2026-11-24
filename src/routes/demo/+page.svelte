<script lang="ts">
	import { page } from '$app/state';
	type View = 'overview' | 'stream' | 'issues';
	const requestedView = page.url.searchParams.get('view');
	let view = $state<View>(
		requestedView === 'stream' || requestedView === 'issues' ? requestedView : 'overview'
	);

	const topics = [
		{ name: 'Infrastructure', count: 42, sentiment: 68, color: '#e99f68' },
		{ name: 'Waste management', count: 31, sentiment: 51, color: '#79b7a5' },
		{ name: 'Healthcare', count: 18, sentiment: 26, color: '#809bd4' }
	];
	const comments = [
		{
			time: '09:42',
			place: 'Sample district · North',
			topic: 'Infrastructure',
			text: 'The footbridge lights have been out for two evenings.',
			sentiment: 'Negative'
		},
		{
			time: '09:18',
			place: 'Sample district · Central',
			topic: 'Waste management',
			text: 'Collection arrived on schedule this morning. Thank you!',
			sentiment: 'Positive'
		},
		{
			time: '08:56',
			place: 'Sample district · South',
			topic: 'Healthcare',
			text: 'Is the community health desk open on Saturdays?',
			sentiment: 'Neutral'
		}
	];
	const issues = [
		{
			id: 'DEMO-104',
			title: 'Repair footbridge lighting',
			topic: 'Infrastructure',
			priority: 'High',
			status: 'In progress'
		},
		{
			id: 'DEMO-103',
			title: 'Confirm waste collection schedule',
			topic: 'Waste management',
			priority: 'Medium',
			status: 'Under review'
		},
		{
			id: 'DEMO-102',
			title: 'Publish health desk hours',
			topic: 'Healthcare',
			priority: 'Low',
			status: 'Resolved'
		}
	];
</script>

<svelte:head>
	<title>Read-only demo · Civic Pulse Engine</title>
	<meta
		name="description"
		content="Explore a read-only Civic Pulse Engine showcase with fictional data."
	/>
</svelte:head>

<div class="demo-shell">
	<header class="topbar">
		<a class="brand" href="/" aria-label="Civic Pulse Engine home"
			><span class="pulse">∿</span> CIVIC PULSE <span class="brand-light">ENGINE</span></a
		>
		<div class="topbar-right">
			<span class="live-dot"></span> SYNTHETIC DATA <a href="#about">About the project ↓</a>
		</div>
	</header>

	<main>
		<div class="masthead">
			<div>
				<p class="eyebrow">PUBLIC SHOWCASE / READ ONLY</p>
				<h1>From public signal<br />to civic action<span class="period">.</span></h1>
				<p class="intro">
					A guided look at how staff can spot patterns, review incoming feedback, and track
					responses. Every record on this page is fictional.
				</p>
			</div>
			<div class="mast-aside">
				<span>DEMONSTRATION ENVIRONMENT</span><strong>00:00:00</strong><small
					>No login · No live feed · No changes saved</small
				>
			</div>
		</div>

		<nav class="tabs" aria-label="Demo views">
			<button
				class:active={view === 'overview'}
				onclick={() => (view = 'overview')}
				aria-current={view === 'overview' ? 'page' : undefined}>Overview</button
			>
			<button
				class:active={view === 'stream'}
				onclick={() => (view = 'stream')}
				aria-current={view === 'stream' ? 'page' : undefined}>Data stream</button
			>
			<button
				class:active={view === 'issues'}
				onclick={() => (view = 'issues')}
				aria-current={view === 'issues' ? 'page' : undefined}>Issue tracker</button
			>
		</nav>

		{#if view === 'overview'}
			<section class="view" aria-label="Overview">
				<div class="section-heading">
					<div>
						<p class="eyebrow">01 / OVERVIEW</p>
						<h2>A clearer picture of local concerns</h2>
					</div>
					<span>ILLUSTRATIVE 7-DAY WINDOW</span>
				</div>
				<div class="stats">
					<div>
						<span>COMMENTS ANALYZED</span><strong>124</strong><small>Fictional examples</small>
					</div>
					<div><span>OPEN ISSUES</span><strong>08</strong><small>Awaiting staff action</small></div>
					<div><span>FLAGGED CLAIMS</span><strong>03</strong><small>For human review</small></div>
				</div>
				<div class="panel">
					<div class="panel-title">
						<h3>Topics requiring attention</h3>
						<span>VOLUME / NEGATIVE SHARE</span>
					</div>
					{#each topics as topic}<div class="topic">
							<div class="topic-name">
								<strong>{topic.name}</strong><span>{topic.count} comments</span>
							</div>
							<div class="bar">
								<span style={`width: ${topic.sentiment}%; background: ${topic.color}`}></span>
							</div>
							<b>{topic.sentiment}%</b>
						</div>{/each}
					<p class="footnote">Negative share is an illustrative measure, not a live finding.</p>
				</div>
			</section>
		{:else if view === 'stream'}
			<section class="view" aria-label="Data stream">
				<div class="section-heading">
					<div>
						<p class="eyebrow">02 / DATA STREAM</p>
						<h2>Feedback, with context</h2>
					</div>
					<span>FICTIONAL ENTRIES</span>
				</div>
				<div class="panel stream">
					{#each comments as comment}<article class="comment">
							<div class="comment-meta">
								<b>{comment.time}</b><span>{comment.place}</span><span class="chip"
									>{comment.topic}</span
								>
							</div>
							<p>{comment.text}</p>
							<span class="sentiment">{comment.sentiment} sentiment</span>
						</article>{/each}
				</div>
			</section>
		{:else}
			<section class="view" aria-label="Issue tracker">
				<div class="section-heading">
					<div>
						<p class="eyebrow">03 / ISSUE TRACKER</p>
						<h2>Keep the response moving</h2>
					</div>
					<span>FICTIONAL TICKETS</span>
				</div>
				<div class="panel issue-list">
					<div class="issue-head">
						<span>ID / ISSUE</span><span>TOPIC</span><span>PRIORITY</span><span>STATUS</span>
					</div>
					{#each issues as issue}<article class="issue">
							<div><small>{issue.id}</small><strong>{issue.title}</strong></div>
							<span>{issue.topic}</span><span>{issue.priority}</span><b>{issue.status}</b>
						</article>{/each}
				</div>
				<p class="footnote">
					The production issue workflow requires authorized staff. This showcase cannot create,
					edit, or export records.
				</p>
			</section>
		{/if}
		<footer id="about" class="demo-about">
			<strong>About this showcase</strong>
			<p>
				Civic Pulse Engine is a staff-facing prototype for reviewing public feedback and managing
				local issues. This page demonstrates the workflow with invented records. The real staff
				application requires an invitation and is separate from this read-only showcase.
			</p>
		</footer>
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #f4f5f3;
		color: #142b32;
		font-family: Arial, Helvetica, sans-serif;
	}
	:global(button) {
		font: inherit;
	}
	.demo-shell {
		min-height: 100vh;
	}
	.demo-about {
		border-top: 1px solid #c9d2cf;
		margin-top: 64px;
		padding: 25px 0 0;
		display: flex;
		gap: 36px;
		font-size: 13px;
		line-height: 1.6;
	}
	.demo-about strong {
		min-width: 170px;
	}
	.demo-about p {
		max-width: 700px;
		margin: 0;
		color: #526a68;
	}
	.topbar {
		height: 68px;
		padding: 0 clamp(22px, 5vw, 80px);
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #142b32;
		color: #fff;
	}
	.brand {
		text-decoration: none;
		color: #fff;
		font-size: 15px;
		font-weight: 800;
		letter-spacing: 0.08em;
	}
	.brand-light {
		font-weight: 400;
		opacity: 0.8;
	}
	.pulse {
		font-size: 28px;
		color: #d4ed7b;
		vertical-align: -3px;
		margin-right: 10px;
	}
	.topbar-right {
		display: flex;
		gap: 13px;
		align-items: center;
		font-size: 10px;
		letter-spacing: 0.13em;
		font-weight: 700;
	}
	.topbar-right a {
		color: #fff;
		text-decoration: none;
		margin-left: 30px;
		font-size: 12px;
		letter-spacing: 0;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		background: #d4ed7b;
		border-radius: 100%;
	}
	main {
		max-width: 1440px;
		margin: auto;
		padding: 0 clamp(22px, 5vw, 80px) 80px;
	}
	.masthead {
		padding: 74px 0 58px;
		display: flex;
		justify-content: space-between;
		gap: 40px;
	}
	.eyebrow {
		font-size: 11px;
		letter-spacing: 0.18em;
		font-weight: 800;
		color: #47746d;
		margin: 0 0 21px;
	}
	h1 {
		font-size: clamp(48px, 6vw, 88px);
		line-height: 0.99;
		letter-spacing: -0.065em;
		margin: 0 0 26px;
		font-weight: 700;
	}
	.period {
		color: #77a18f;
	}
	.intro {
		font-size: 17px;
		line-height: 1.6;
		max-width: 600px;
		color: #4c6064;
		margin: 0;
	}
	.mast-aside {
		align-self: end;
		border-left: 1px solid #aebfbd;
		padding-left: 23px;
		min-width: 220px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mast-aside span,
	.mast-aside small {
		font-size: 10px;
		letter-spacing: 0.08em;
		color: #597174;
	}
	.mast-aside strong {
		font-size: 35px;
		font-weight: 400;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
	}
	.tabs {
		display: flex;
		gap: 35px;
		border-bottom: 1px solid #c9d2cf;
	}
	.tabs button {
		border: 0;
		background: none;
		padding: 17px 0;
		color: #6d8081;
		cursor: pointer;
		font-weight: 700;
		font-size: 13px;
	}
	.tabs button.active {
		color: #142b32;
		border-bottom: 3px solid #142b32;
	}
	.tabs button:focus-visible,
	.topbar a:focus-visible {
		outline: 3px solid #7ba98b;
		outline-offset: 4px;
	}
	.view {
		padding-top: 46px;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 20px;
		margin-bottom: 30px;
	}
	.section-heading .eyebrow {
		margin-bottom: 12px;
	}
	.section-heading h2 {
		font-size: clamp(27px, 3vw, 39px);
		letter-spacing: -0.045em;
		margin: 0;
	}
	.section-heading > span,
	.panel-title span {
		font-size: 10px;
		letter-spacing: 0.13em;
		color: #6e8282;
		font-weight: 700;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1px;
		background: #c8d5d0;
		border: 1px solid #c8d5d0;
		margin-bottom: 18px;
	}
	.stats > div {
		background: #fff;
		padding: 25px 30px;
		display: flex;
		flex-direction: column;
	}
	.stats span {
		font-size: 11px;
		letter-spacing: 0.12em;
		font-weight: 800;
		color: #55716f;
	}
	.stats strong {
		font-size: 57px;
		letter-spacing: -0.06em;
		margin: 10px 0 3px;
	}
	.stats small {
		color: #748987;
	}
	.panel {
		background: #fff;
		border: 1px solid #c8d5d0;
		padding: 26px 30px;
	}
	.panel-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.panel-title h3 {
		font-size: 18px;
		margin: 0;
	}
	.topic {
		display: grid;
		grid-template-columns: 250px 1fr 55px;
		gap: 28px;
		align-items: center;
		border-top: 1px solid #e4eae7;
		padding: 19px 0;
	}
	.topic-name {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 13px;
	}
	.topic-name span {
		color: #738886;
	}
	.bar {
		height: 10px;
		background: #edf0eb;
	}
	.bar span {
		display: block;
		height: 100%;
	}
	.topic b {
		text-align: right;
		font-size: 13px;
	}
	.footnote {
		color: #718582;
		font-size: 12px;
		margin: 17px 0 0;
	}
	.comment {
		padding: 22px 0;
		border-bottom: 1px solid #e4eae7;
	}
	.comment:last-child {
		border-bottom: 0;
	}
	.comment-meta {
		display: flex;
		gap: 15px;
		align-items: center;
		color: #6b8281;
		font-size: 12px;
	}
	.comment-meta b {
		color: #173d41;
	}
	.chip {
		background: #eef4ec;
		padding: 5px 10px;
		color: #326250;
	}
	.comment p {
		font-size: 18px;
		margin: 17px 0;
	}
	.sentiment {
		font-size: 11px;
		color: #526a68;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.issue-head,
	.issue {
		display: grid;
		grid-template-columns: 2fr 1fr 0.65fr 0.8fr;
		gap: 20px;
		align-items: center;
	}
	.issue-head {
		color: #708481;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.13em;
		padding: 2px 0 16px;
	}
	.issue {
		border-top: 1px solid #e4eae7;
		padding: 20px 0;
		font-size: 13px;
	}
	.issue > div {
		display: flex;
		gap: 18px;
		align-items: center;
	}
	.issue small {
		font-size: 11px;
		color: #708481;
	}
	.issue strong {
		font-size: 15px;
	}
	.issue b {
		font-weight: 700;
		color: #47746d;
	}
	@media (max-width: 800px) {
		.demo-about {
			display: block;
		}
		.demo-about p {
			margin-top: 8px;
		}
		.masthead {
			display: block;
			padding: 50px 0 45px;
		}
		.mast-aside {
			margin-top: 30px;
		}
		.topbar-right span:not(.live-dot) {
			display: none;
		}
		.topbar-right a {
			margin-left: 0;
		}
		.section-heading > span {
			display: none;
		}
		.stats {
			grid-template-columns: 1fr;
		}
		.topic {
			grid-template-columns: 1fr 55px;
			gap: 10px;
		}
		.topic-name {
			grid-column: 1 / -1;
		}
		.issue-head {
			display: none;
		}
		.issue {
			grid-template-columns: 1fr 1fr;
		}
		.issue > div {
			grid-column: 1 / -1;
		}
		.issue span,
		.issue b {
			font-size: 12px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			scroll-behavior: auto;
		}
	}
</style>
