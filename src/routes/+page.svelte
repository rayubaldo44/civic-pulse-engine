<script lang="ts">
	import { onMount } from 'svelte';
	import { motion, MotionConfig } from '@humanspeak/svelte-motion';
	import ConsolePanel from '$lib/components/ConsolePanel.svelte';
	import { applySystemTheme, watchSystemTheme } from '$lib/theme/system';

	// The landing page always tracks the OS theme, live. Re-applies on entry
	// (so an override persisted by the dashboard toggle can't pin this page)
	// and re-arms the matchMedia listener on navigation; cleanup on unmount
	// hands theme control back to pages that expose a manual toggle.
	$effect(() => {
		applySystemTheme();
		return watchSystemTheme();
	});

	// Hero entry choreography — explicit per-beat delays so the kicker, headline,
	// subhead, CTA, and ECG/trust line land as one signal-room sequence.
	const RISE_EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];
	const beat = (delay: number, y = 24, duration = 0.55) => ({
		initial: { opacity: 0, y },
		whileInView: { opacity: 1, y: 0 },
		viewport: { once: true, amount: 0.4 },
		transition: { duration, delay, ease: RISE_EASE }
	});

	// Headline word-stagger — the three declarative lines reveal word-by-word
	// out of clipped masks, handing off one line at a time. Variant state
	// cascades from motion.h1 down through each .lineMask clip to its words.
	const headline = {
		hidden: {},
		visible: { transition: { staggerChildren: 0.14 } }
	};
	const lineMask = {
		hidden: {},
		visible: { transition: { staggerChildren: 0.045 } }
	};
	const word = {
		hidden: { opacity: 0, y: '110%' },
		visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: RISE_EASE } }
	};

	// ── Bento: Key Features ────────────────────────────────────────────────
	// Each card observes itself (whileInView) and staggers its readout
	// micro-animations via variant propagation — the label mechanism the hero
	// headline uses. Transforms stay on card/readout elements only, never on
	// section/page-root wrappers (CONTEXT.md "Never Do").
	const card = {
		hidden: { opacity: 0, y: 26 },
		visible: {
			opacity: 1,
			y: 0,
			transition: { duration: 0.6, ease: RISE_EASE, delayChildren: 0.15, staggerChildren: 0.05 }
		}
	};
	const stack = {
		hidden: {},
		visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } }
	};
	const group = {
		hidden: {},
		visible: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } }
	};
	const idle = { hidden: {}, visible: {} };
	const microIn = {
		hidden: { opacity: 0, y: 10 },
		visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: RISE_EASE } }
	};
	const rowIn = {
		hidden: { opacity: 0, x: -10 },
		visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: RISE_EASE } }
	};
	const growBar = {
		hidden: { scaleX: 0 },
		visible: { scaleX: 1, transition: { duration: 0.6, ease: RISE_EASE } }
	};
	const fadeArea = {
		hidden: { opacity: 0 },
		visible: { opacity: 1, transition: { duration: 0.5, delay: 0.3 } }
	};
	const drawLine = {
		hidden: { pathLength: 0 },
		visible: { pathLength: 1, transition: { duration: 1.1, ease: RISE_EASE } }
	};

	const ICONS: Record<string, string> = {
		sentiment: 'M2 12h4l3-7 6 14 3-7 3 0',
		topics: 'M4 5h16M4 11h16M4 17h16',
		claims: 'M12 3l7 3v5c0 4.2-2.8 8.2-7 9.5-4.2-1.3-7-5.3-7-9.5V6zm-3 9l2 2 4-4',
		map: 'M12 21s-7-5.4-7-11a7 7 0 1114 0c0 5.6-7 11-7 11zm0-8a3 3 0 100-6 3 3 0 000 6z',
		priority: 'M12 4v16m-5-11l5-5 5 5M7 15l5 5 5-5',
		track: 'M12 8v4l3 3m6-3a9 9 0 11-9-9 9 9 0 019 9z',
		export: 'M12 3v12m-5-5l5 5 5-5M5 21h14',
		audit: 'M10 6h11M10 12h11M10 18h11M4 6l1.5 1.5L8 5m-4 7l1.5 1.5L8 12m-4 7l1.5 1.5L8 18'
	};

	// Hero ECG trace — 5 beats across a 640x32 viewBox. Single source for both
	// the drawn path and the .ecg-head offset-path so they can't drift.
	const PULSE_PATH =
		'M0 16 L32 16 L35 11 L38 20 L41 16 L47 16 L51 8 L55 23 L59 16 L64 16 L128 16 L160 16 L163 11 L166 20 L169 16 L175 16 L179 8 L183 23 L187 16 L192 16 L256 16 L288 16 L291 11 L294 20 L297 16 L303 16 L307 8 L311 23 L315 16 L320 16 L384 16 L416 16 L419 11 L422 20 L425 16 L431 16 L435 8 L439 23 L443 16 L448 16 L512 16 L544 16 L547 11 L550 20 L553 16 L559 16 L563 8 L567 23 L571 16 L576 16 L640 16';

	const PIPELINE = [
		{
			step: '01',
			tag: 'IMPORT',
			title: 'Collect Public Comments',
			body: 'Imports public comments from relevant YouTube videos into the prototype for analysis.',
			meta: ['Public YouTube comments', 'Source import', 'Prototype scope']
		},
		{
			step: '02',
			tag: 'PRIVACY',
			title: 'Protect Author Identity',
			body: 'Replaces the public author identifier with a one-way code before storage and keeps the analysis focused on comment content.',
			meta: ['Hashed author identifiers', 'Before storage', 'Data minimization']
		},
		{
			step: '03',
			tag: 'ANALYZE',
			title: 'Understand the Comment',
			body: 'Classifies each comment by sentiment (positive, negative, neutral), sorts it into a civic topic, and detects verifiable factual claims. Tuned for Tagalog, English, and Taglish.',
			meta: ['Sentiment', 'Civic topic', 'Claim detection', 'Tagalog · English · Taglish']
		},
		{
			step: '04',
			tag: 'EVIDENCE',
			title: 'Match Official Evidence',
			body: 'Compares each flagged claim with relevant passages from official LGU documents and prepares a suggested evidence status for staff review.',
			meta: ['Official LGU records', 'Supported', 'Refuted', 'Insufficient evidence']
		},
		{
			step: '05',
			tag: 'REVIEW',
			title: 'Staff Makes the Decision',
			body: 'Every flag enters a staff review queue. Automated analysis can suggest; only an authorized staff member makes the final call.',
			meta: ['Staff review queue', 'Human decision', 'Recorded outcome']
		}
	];

	// Single-open pipeline accordion. Step 01 opens on load so the section
	// never reads as a wall of collapsed rows. Scrolling auto-advances the open
	// step (see onMount); a manual click pauses that until the section leaves
	// the viewport, and keyboard focus inside the section pauses it too.
	let openStep = $state(0);
	let autoPaused = $state(false);
	let focusPaused = $state(false);
	function toggleStep(index: number) {
		autoPaused = true;
		openStep = openStep === index ? -1 : index;
	}

	const FAILURES = [
		{
			eyebrow: 'Volume',
			body: "Local governments can't manually track thousands of social media comments."
		},
		{
			eyebrow: 'Latency',
			body: 'Surveys and public meetings gather feedback too late.'
		},
		{
			eyebrow: 'Language',
			body: 'Most AI tools for civic sentiment are built for national-level, English-only discourse - not the Tagalog-English reality of Philippine local government.'
		}
	];

	const FEATURES = [
		{
			title: 'Understand public sentiment',
			body: 'See how the analyzed sample shifts across civic topics and where concerns are concentrated.',
			eyebrow: 'Listen · Sentiment and topics',
			icon: 'sentiment',
			spark: 'sentiment',
			span: 'md:col-span-2',
			variant: ''
		},
		{
			title: 'Verify claims against official records',
			body: 'Compare flagged statements with matching LGU evidence before a staff member decides.',
			eyebrow: 'Verify · Claims and evidence',
			icon: 'claims',
			spark: 'claims',
			span: '',
			variant: 'tint'
		},
		{
			title: 'Prioritize action',
			body: 'Rank recurring concerns and carry them into a staff-owned issue workflow.',
			eyebrow: 'Act · Priority and follow-through',
			icon: 'priority',
			spark: 'priority',
			span: '',
			variant: ''
		}
	];

	const SUPPORTING_CAPABILITIES = [
		{
			title: 'Topic classification',
			body: 'Groups comments into five civic categories.',
			icon: 'topics'
		},
		{
			title: 'Barangay context',
			body: 'Organizes detected mentions across Pulilan.',
			icon: 'map'
		},
		{
			title: 'Issue tracking',
			body: 'Keeps ownership and status visible to staff.',
			icon: 'track'
		},
		{
			title: 'Briefing exports',
			body: 'Produces CSV and PDF reporting outputs.',
			icon: 'export'
		},
		{
			title: 'Access and audit',
			body: 'Records authorized staff activity.',
			icon: 'audit'
		}
	];

	const METRICS = [
		{ value: 18, suffix: '', label: 'barangays represented in the geographic analysis model' },
		{ value: 5, suffix: '-step', label: 'verification pipeline from ingestion to human review' },
		{ value: 3, suffix: '', label: 'languages supported: Tagalog, English, and Taglish' }
	];

	const BARANGAYS = [
		'Alagao',
		'Aulaga',
		'Bagong Buhay',
		'Balubad',
		'Bambang',
		'Dampol 1st-A',
		'Dampol 2nd-A',
		'Dampol 2nd-B',
		'Dulong Malabon',
		'Inaon',
		'Lumbac',
		'Lunt',
		'Magnificat',
		'Marinig',
		'Niugan',
		'Poblacion',
		'Polo',
		'Remlo'
	];

	// ── Bento readout payloads (illustrative samples; see ConsolePanel) ─────
	const TOPIC_MIX = [
		{ label: 'Infrastructure', pct: 28 },
		{ label: 'Healthcare', pct: 24 },
		{ label: 'Waste Management', pct: 20 },
		{ label: 'Public Safety', pct: 16 },
		{ label: 'Other', pct: 12 }
	];
	const PRIORITY_ROWS = [
		{ rank: 1, topic: 'Waste Management', status: 'New', score: 84 },
		{ rank: 2, topic: 'Public Safety', status: 'Monitoring', score: 71 },
		{ rank: 3, topic: 'Infrastructure', status: 'Monitoring', score: 63 }
	];
	const VERDICTS = [
		{ label: 'Supported', state: 'off' },
		{ label: 'Refuted', state: 'on' },
		{ label: 'Insufficient Evidence', state: 'off' }
	];

	// Featured sentiment readout — a live trace across a 7-day window.
	const SENTIMENT_LIVE =
		'M0 76 L40 70 L80 74 L120 58 L144 63 L184 47 L216 51 L256 33 L288 39 L320 42';

	const STACK = [
		'SvelteKit',
		'TypeScript',
		'Tailwind CSS',
		'Supabase',
		'Python',
		'FastAPI',
		'Hugging Face',
		'Claude Haiku',
		'Vercel',
		'GitHub Actions'
	];

	function formatMetric(value: number): string {
		return new Intl.NumberFormat('en-PH').format(value);
	}

	function statusTone(status: string): string {
		return status === 'New'
			? 'border-signal-200 bg-signal-50 text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400'
			: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400';
	}

	onMount(() => {
		// Scroll reveal + metric count-up observer
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.classList.add('on');
						const scrubItems = entry.target.querySelectorAll('.scrub > span');
						scrubItems.forEach((span, si) => {
							setTimeout(() => span.classList.add('on'), si * 80);
						});
					}
				});
			},
			{ threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
		);
		document.querySelectorAll('.reveal, .scrub').forEach((el) => observer.observe(el));

		// Metric count-up animation
		const reduceMotion =
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const metricObserver = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						const el = entry.target as HTMLElement;
						const target = parseInt(el.dataset.target || '0', 10);
						const suffix = el.dataset.suffix || '';
						if (reduceMotion) {
							el.textContent = formatMetric(target) + suffix;
							metricObserver.unobserve(el);
							return;
						}
						el.textContent = formatMetric(0) + suffix;
						const duration = 1400;
						const start = performance.now();
						function tick(now: number) {
							const elapsed = now - start;
							const progress = Math.min(elapsed / duration, 1);
							const eased = 1 - Math.pow(1 - progress, 3);
							el.textContent = formatMetric(Math.round(eased * target)) + suffix;
							if (progress < 1) requestAnimationFrame(tick);
						}
						requestAnimationFrame(tick);
						metricObserver.unobserve(el);
					}
				});
			},
			{ threshold: 0.3 }
		);
		document.querySelectorAll('.metric-num').forEach((el) => metricObserver.observe(el));

		// Pipeline scroll-sync — a thin "read line" across the viewport opens
		// whichever step header crosses it. Because an opened panel only adds
		// height below its own header, the trigger positions above the line
		// stay stable, so this converges instead of oscillating. Skipped for
		// reduced motion (manual clicks remain) and while the user is acting.
		const pipelineSection = document.getElementById('methodology');
		const triggers = document.querySelectorAll<HTMLElement>('.pipeline-trigger');

		const pipelineObserver = new IntersectionObserver(
			(entries) => {
				if (reduceMotion || autoPaused || focusPaused) return;
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					const index = Number((entry.target as HTMLElement).dataset.stepIndex);
					if (!Number.isNaN(index)) openStep = index;
				});
			},
			{ rootMargin: '-42% 0px -54% 0px', threshold: 0 }
		);
		triggers.forEach((el) => pipelineObserver.observe(el));

		// Reset both pauses once the pipeline has fully left the viewport, so
		// the next visit resumes auto-advance (a click leaves focus on its
		// button, so focusPaused must clear here too).
		const sectionObserver = new IntersectionObserver(([entry]) => {
			if (!entry.isIntersecting) {
				autoPaused = false;
				focusPaused = false;
			}
		});
		if (pipelineSection) sectionObserver.observe(pipelineSection);

		// Keyboard focus inside the section suspends auto-advance so focus is
		// never yanked out from under the user.
		const onFocusIn = () => {
			focusPaused = true;
		};
		const onFocusOut = () => {
			queueMicrotask(() => {
				if (pipelineSection && !pipelineSection.contains(document.activeElement)) {
					focusPaused = false;
				}
			});
		};
		pipelineSection?.addEventListener('focusin', onFocusIn);
		pipelineSection?.addEventListener('focusout', onFocusOut);

		return () => {
			observer.disconnect();
			metricObserver.disconnect();
			pipelineObserver.disconnect();
			sectionObserver.disconnect();
			pipelineSection?.removeEventListener('focusin', onFocusIn);
			pipelineSection?.removeEventListener('focusout', onFocusOut);
		};
	});
</script>

<svelte:head>
	<title>Civic Pulse - Pulilan LGU Intelligence Engine</title>
	<meta
		name="description"
		content="Civic Pulse turns public sentiment in Pulilan, Bulacan into verified, actionable civic intelligence for the LGU."
	/>
</svelte:head>

<div class="relative min-h-dvh overflow-clip">
	<!-- Soft signal glow -->
	<div class="landing-glow pointer-events-none absolute inset-0"></div>

	<a
		href="#main-content"
		class="sr-only fixed top-3 left-3 z-[60] rounded-lg bg-signal-600 px-4 py-3 text-sm font-semibold text-white shadow-md focus:not-sr-only focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-2 focus-visible:outline-none"
	>
		Skip to main content
	</a>

	<!-- Sticky Nav -->
	<nav class="glass-nav">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10">
			<a href="/" class="flex items-center gap-3">
				<img
					src="/img/civic-pulse-mark.png"
					alt=""
					class="h-9 w-9 object-contain dark:brightness-150"
					width="36"
					height="36"
				/>
				<span class="font-display text-xl text-ink">Civic Pulse</span>
			</a>
			<div class="flex items-center gap-4">
				<span
					class="hidden font-mono text-[11px] tracking-widest text-ink-muted uppercase md:block"
				>
					Municipality of Pulilan, Bulacan
				</span>
				<a href="/login" class="btn-primary min-h-11 px-5 py-2 text-sm">Staff sign in</a>
			</div>
		</div>
	</nav>

	<main id="main-content" class="relative mx-auto max-w-6xl px-6 md:px-10" tabindex="-1">
		<!-- Hero: Signal-Room Editorial Split -->
		<section class="section hero-pad">
			<MotionConfig reducedMotion="user">
				<div class="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center lg:gap-14">
					<div class="max-w-xl">
						<motion.h1
							variants={headline}
							initial="hidden"
							whileInView="visible"
							viewport={{ once: true, amount: 0.3 }}
							class="max-w-4xl font-display text-[clamp(2.25rem,5.5vw,3.75rem)] leading-[1.05] tracking-tight text-ink md:text-[clamp(2.75rem,5.5vw,4.5rem)] lg:text-[clamp(2.5rem,4vw,4rem)]"
						>
							<motion.span variants={lineMask} class="block overflow-hidden">
								<motion.span variants={word} class="mr-[0.25em] inline-block">Listen</motion.span>
								<motion.span variants={word} class="mr-[0.25em] inline-block">to</motion.span>
								<motion.span variants={word} class="mr-[0.25em] inline-block">your</motion.span>
								<motion.span variants={word} class="inline-block">community.</motion.span>
							</motion.span>
							<motion.span variants={lineMask} class="block overflow-hidden">
								<i class="text-signal-600 dark:text-signal-400">
									<motion.span variants={word} class="mr-[0.25em] inline-block">Verify</motion.span>
									<motion.span variants={word} class="mr-[0.25em] inline-block">what's</motion.span>
									<motion.span variants={word} class="inline-block">true.</motion.span>
								</i>
							</motion.span>
							<motion.span variants={lineMask} class="block overflow-hidden">
								<motion.span variants={word} class="mr-[0.25em] inline-block">Govern</motion.span>
								<motion.span variants={word} class="mr-[0.25em] inline-block">with</motion.span>
								<motion.span variants={word} class="inline-block">evidence.</motion.span>
							</motion.span>
						</motion.h1>
						<motion.p
							{...beat(0.38)}
							class="mt-6 text-lg leading-relaxed text-ink-muted md:text-xl"
						>
							Reads public sentiment, verifies claims against official LGU documents, and surfaces
							issues your staff can act on.
						</motion.p>
						<motion.div {...beat(0.48)} class="mt-6 flex flex-wrap items-center gap-3">
							<a href="/login" class="btn-primary min-h-11 px-6 py-1.5 text-base">Staff sign in</a>
							<a href="#methodology" class="btn-secondary min-h-11 px-6 py-1.5 text-base"
								>Review the methodology</a
							>
						</motion.div>
						<motion.div {...beat(0.58)}>
							<svg
								class="hero-pulse"
								viewBox="0 0 640 32"
								fill="none"
								aria-hidden="true"
								style={`--ecg-path: path('${PULSE_PATH}')`}
							>
								<path class="pulse-line" d={PULSE_PATH} />
								<path class="pulse-trail" pathLength="100" d={PULSE_PATH} />
								<circle class="pulse-tip" cx="640" cy="16" r="2.5" />
								<circle class="ecg-head" r="3" />
							</svg>
							<p class="hero-trust">
								<span>Hashed author identifiers</span>
								<span aria-hidden="true">·</span>
								<span>Human-in-the-loop review</span>
								<span aria-hidden="true">·</span>
								<span>18-barangay geographic model</span>
							</p>
						</motion.div>
					</div>

					<motion.div {...beat(0.3, 30, 0.6)} class="relative">
						<div class="graticule" aria-hidden="true"></div>
						<div class="scope-frame">
							<div class="scope-channel">
								<span
									class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
									>Ch-01 · Sample sentiment view</span
								>
								<span
									class="flex items-center gap-1.5 font-mono text-[11px] text-signal-600 dark:text-signal-400"
								>
									<span class="pulse-dot bg-signal-600 dark:bg-signal-400"></span>
									Signal
								</span>
							</div>
							<ConsolePanel flushed />
						</div>
					</motion.div>
				</div>
			</MotionConfig>
		</section>

		<!-- Problem Chapter -->
		<section class="section">
			<MotionConfig reducedMotion="user">
				<div class="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-end lg:gap-14">
					<div class="reveal max-w-xl">
						<span class="font-mono text-[11px] tracking-[0.18em] text-ink-muted uppercase"
							>The problem</span
						>
						<h2
							class="scrub mt-5 font-display text-3xl leading-snug tracking-tight text-ink md:text-4xl"
						>
							<span>By</span> <span>the</span> <span>time</span> <span>you</span>
							<span>hear</span> <span>about</span> <span>it,</span> <span>public</span>
							<span>opinion</span> <span>has</span> <span>already</span> <span>moved</span>
							<span>on.</span>
						</h2>
					</div>

					<motion.div
						variants={card}
						initial="hidden"
						whileInView="visible"
						viewport={{ once: true, amount: 0.18 }}
					>
						<div class="scope-frame">
							<div class="scope-channel">
								<span
									class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
									>Operational challenge</span
								>
								<span
									class="flex items-center gap-1.5 font-mono text-[11px] text-signal-600 dark:text-signal-400"
								>
									<span class="pulse-dot bg-signal-600 dark:bg-signal-400"></span>
									Pulilan
								</span>
							</div>
							<div class="font-display text-3xl leading-tight tracking-tight text-ink md:text-4xl">
								Public conversation moves faster than manual review.
							</div>
							<p class="mt-3 text-sm leading-relaxed text-ink-muted">
								Civic Pulse helps staff organize high-volume comments, identify patterns, and route
								verifiable claims to human review. It supports a response; it does not replace one.
							</p>
						</div>
					</motion.div>
				</div>

				<div class="mt-6 grid grid-cols-1 gap-3 md:mt-8 md:grid-cols-3">
					{#each FAILURES as f (f.eyebrow)}
						<motion.div
							variants={card}
							initial="hidden"
							whileInView="visible"
							viewport={{ once: true, amount: 0.18 }}
							class="h-full"
						>
							<div class="bento-card">
								<span
									class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
									>{f.eyebrow}</span
								>
								<p class="mt-3 text-sm leading-relaxed text-ink-muted">{f.body}</p>
							</div>
						</motion.div>
					{/each}
				</div>
			</MotionConfig>
		</section>

		<!-- Bento: Key Features -->
		<section class="section">
			<MotionConfig reducedMotion="user">
				<div class="mx-auto mb-14 max-w-2xl md:mb-16">
					<span class="font-mono text-[11px] tracking-[0.18em] text-ink-muted uppercase"
						>Key capabilities</span
					>
					<h2 class="mt-3 font-display text-3xl leading-snug tracking-tight text-ink md:text-4xl">
						One <i class="text-signal-600 dark:text-signal-400">signal room</i> for the whole municipality.
					</h2>
					<p class="mt-4 text-sm leading-relaxed text-ink-muted">
						The interface previews below use illustrative sample data to demonstrate the workflow;
						they are not live municipal statistics.
					</p>
				</div>

				<div class="bento-grid">
					{#each FEATURES as f (f.title)}
						<motion.div
							variants={card}
							initial="hidden"
							whileInView="visible"
							viewport={{ once: true, amount: 0.18 }}
							class={f.span}
						>
							<div
								class="bento-card {f.variant === 'tint' ? 'bento-tint' : ''}{f.spark === 'sentiment'
									? ' flex flex-col'
									: ''}"
							>
								<div class="mb-3 flex items-start justify-between gap-2">
									<span
										class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
										>{f.eyebrow}</span
									>
									<svg
										class="h-4 w-4 shrink-0 text-signal-600 dark:text-signal-400"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d={ICONS[f.icon]} />
									</svg>
								</div>

								{#if f.spark === 'sentiment'}
									<motion.div variants={stack} class="mb-4 flex flex-1 flex-col">
										<div class="mb-3 flex items-center justify-between gap-3">
											<span
												class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
												>Illustrative sentiment · 7-day window</span
											>
											<span
												class="flex items-center gap-1.5 font-mono text-[11px] font-medium text-signal-600 dark:text-signal-400"
											>
												<span
													class="relative inline-block h-1.5 w-1.5 rounded-full bg-signal-600 dark:bg-signal-400"
												>
													<span
														class="pulse-halo absolute inset-0 rounded-full bg-signal-600 dark:bg-signal-400"
													></span>
												</span>
												SAMPLE
											</span>
										</div>

										<motion.div variants={idle} class="flex min-h-0 flex-1 flex-col">
											<svg
												class="featured-chart min-h-28 w-full flex-1 text-signal-600 dark:text-signal-400"
												viewBox="0 0 320 88"
												fill="none"
												aria-hidden="true"
												style={`--bento-path: path('${SENTIMENT_LIVE}')`}
											>
												<path
													d="M0 22 H320 M0 44 H320 M0 66 H320"
													stroke="currentColor"
													stroke-width="0.5"
													opacity="0.08"
												/>
												<motion.g variants={fadeArea}>
													<path
														d="{SENTIMENT_LIVE} L320 88 L0 88 Z"
														fill="color-mix(in srgb, currentColor 8%, transparent)"
													/>
												</motion.g>
												<motion.path
													variants={drawLine}
													d={SENTIMENT_LIVE}
													stroke="currentColor"
													stroke-width="1.5"
													stroke-linecap="round"
													stroke-linejoin="round"
												/>
												<circle class="bento-sweep" r="3" fill="currentColor" />
												<circle cx="320" cy="42" r="3" fill="currentColor" />
												<circle cx="320" cy="42" r="6" fill="currentColor" opacity="0.15" />
											</svg>
										</motion.div>

										<motion.div variants={group} class="mt-3">
											<div
												class="mb-1.5 flex items-center justify-between font-mono text-[11px] tracking-widest text-ink-faint uppercase"
											>
												<span>Sentiment mix</span>
												<span>2,847 comments · sampled</span>
											</div>
											<div class="flex h-2.5 overflow-hidden rounded-full">
												<motion.div
													variants={growBar}
													class="h-full origin-left bg-signal-600"
													style="width: 38%"
												></motion.div>
												<motion.div
													variants={growBar}
													class="h-full origin-left bg-rose-500"
													style="width: 27%"
												></motion.div>
												<motion.div
													variants={growBar}
													class="h-full origin-left bg-ink-faint"
													style="width: 35%"
												></motion.div>
											</div>
											<div class="mt-1.5 grid grid-cols-3 font-mono text-[11px] text-ink-muted">
												<span>Positive 38%</span>
												<span>Negative 27%</span>
												<span>Neutral 35%</span>
											</div>
										</motion.div>

										<motion.div variants={group} class="mt-3.5 flex flex-wrap gap-1.5">
											{#each TOPIC_MIX.slice(0, 4) as t}
												<motion.span
													variants={microIn}
													class="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-muted"
												>
													{t.label}
												</motion.span>
											{/each}
										</motion.div>
									</motion.div>
								{:else if f.spark === 'claims'}
									<motion.div
										variants={microIn}
										class="mb-3 rounded-lg border border-line bg-surface/70 p-2.5"
									>
										<div
											class="flex items-center justify-between font-mono text-[11px] text-ink-faint"
										>
											<span>SAMPLE CLAIM · EVIDENCE MATCH</span>
											<span class="text-rose-500">needs review</span>
										</div>
										<p class="mt-1 text-xs leading-snug text-ink">
											"Municipal drainage funds were redirected this year…"
										</p>
										<div class="mt-2 space-y-1">
											<div class="flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
												<span class="h-1 w-1 rounded-full bg-signal-400"></span>
												illustrative · budget record
											</div>
											<div class="flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
												<span class="h-1 w-1 rounded-full bg-signal-400"></span>
												illustrative · quarterly report
											</div>
										</div>
									</motion.div>
									<motion.div variants={group} class="mb-3 flex flex-wrap gap-1.5">
										{#each VERDICTS as v}
											<span
												class="rounded-md border px-2 py-0.5 font-mono text-[11px] {v.state === 'on'
													? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400'
													: 'border-line bg-surface text-ink-faint'}"
											>
												{v.label}
											</span>
										{/each}
									</motion.div>
								{:else if f.spark === 'priority'}
									<motion.div variants={group} class="mb-4 space-y-2">
										{#each PRIORITY_ROWS as p}
											<motion.div variants={rowIn} class="flex items-center gap-2">
												<span
													class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-600 font-mono text-[11px] font-semibold text-white"
												>
													{p.rank}
												</span>
												<div class="min-w-0 flex-1">
													<div class="flex items-center justify-between gap-2">
														<span class="truncate text-xs font-medium text-ink">{p.topic}</span>
														<span
															class="rounded-md border px-1.5 py-0.5 font-mono text-[11px] {statusTone(
																p.status
															)}"
														>
															{p.status}
														</span>
													</div>
													<div class="mt-1 h-1 overflow-hidden rounded-full bg-line">
														<motion.div
															variants={growBar}
															class="h-full origin-left rounded-full bg-signal-500"
															style="width: {p.score}%"
														></motion.div>
													</div>
												</div>
											</motion.div>
										{/each}
									</motion.div>
								{/if}

								<h3 class="text-sm font-semibold text-ink">{f.title}</h3>
								<p class="mt-1.5 text-sm leading-relaxed text-ink-muted">{f.body}</p>
							</div>
						</motion.div>
					{/each}
				</div>

				<div class="mt-8 border-y border-line">
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
						{#each SUPPORTING_CAPABILITIES as capability (capability.title)}
							<div
								class="flex gap-3 border-t border-line py-5 first:border-t-0 sm:border-t-0 sm:px-5 lg:border-r lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0"
							>
								<svg
									class="mt-0.5 h-4 w-4 shrink-0 text-signal-600 dark:text-signal-400"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d={ICONS[capability.icon]} />
								</svg>
								<div>
									<h3 class="text-sm font-semibold text-ink">{capability.title}</h3>
									<p class="mt-1 text-xs leading-relaxed text-ink-muted">{capability.body}</p>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</MotionConfig>
		</section>

		<!-- Pipeline -->
		<section id="methodology" class="section">
			<div>
				<div class="mb-14 max-w-2xl md:mb-16">
					<span class="font-mono text-[11px] tracking-[0.18em] text-ink-muted uppercase"
						>Current prototype methodology</span
					>
					<h2 class="mt-3 font-display text-3xl leading-snug tracking-tight text-ink md:text-4xl">
						Five stages. One <i class="text-signal-600 dark:text-signal-400">verified signal</i>.
					</h2>
					<p class="mt-4 text-base leading-relaxed text-ink-muted">
						Each imported comment follows the same analysis path. Author identifiers are hashed
						before storage, and staff retain the final decision on every flagged claim.
					</p>
				</div>

				<ol class="pipeline-rail">
					{#each PIPELINE as p, i (p.step)}
						<li
							class="pipeline-step reveal"
							class:is-open={openStep === i}
							class:is-passed={i < openStep}
							style="transition-delay: {i * 60}ms"
						>
							<button
								type="button"
								id="pipeline-trigger-{p.step}"
								class="pipeline-trigger"
								data-step-index={i}
								aria-expanded={openStep === i}
								aria-controls="pipeline-panel-{p.step}"
								onclick={() => toggleStep(i)}
							>
								<span class="pipeline-dot">{p.step}</span>
								<span class="pipeline-head">
									<span class="pipeline-title">{p.title}</span>
								</span>
								<span class="pipeline-tail">
									<span class="pipeline-tag">{p.tag}</span>
									<svg
										class="pipeline-chevron"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M6 9l6 6 6-6" />
									</svg>
								</span>
							</button>

							<div
								id="pipeline-panel-{p.step}"
								class="pipeline-panel"
								role="region"
								aria-labelledby="pipeline-trigger-{p.step}"
								inert={openStep !== i}
							>
								<div class="pipeline-panel-inner">
									<p class="pipeline-copy">{p.body}</p>
									<ul class="pipeline-meta">
										{#each p.meta as m (m)}
											<li class="pipeline-chip">{m}</li>
										{/each}
									</ul>
								</div>
							</div>
						</li>
					{/each}
				</ol>
			</div>
		</section>

		<!-- Impact Metrics -->
		<section class="section">
			<div class="mx-auto max-w-4xl text-center">
				<h2 class="font-display text-3xl leading-snug tracking-tight text-ink md:text-4xl">
					Why it matters.
				</h2>
				<div class="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
					{#each METRICS as m, i (m.label)}
						<div class="metric-card reveal" style="transition-delay: {i * 100}ms">
							<div class="metric-num" data-target={m.value} data-suffix={m.suffix}>
								{formatMetric(m.value)}{m.suffix}
							</div>
							<div class="metric-label">{m.label}</div>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- Barangay Recognition -->
		<section class="section-tight">
			<div class="mx-auto max-w-4xl">
				<div class="mb-8 text-center">
					<h2 class="font-display text-2xl tracking-tight text-ink md:text-3xl">
						Built around all 18 Pulilan barangays.
					</h2>
					<p class="mt-2 text-sm text-ink-muted">
						The geographic model can organize detected barangay mentions across Pulilan.
					</p>
				</div>
				<div class="bgy-grid">
					{#each BARANGAYS as name (name)}
						<span class="bgy-name">{name}</span>
					{/each}
				</div>
			</div>
		</section>

		<!-- Close: Type-led sign-in, stack as inventory -->
		<section class="section">
			<div class="mx-auto max-w-4xl text-center">
				<div class="reveal mb-10">
					<h2 class="font-display text-3xl leading-snug tracking-tight text-ink md:text-4xl">
						Ready to read the pulse<i class="text-signal-600 dark:text-signal-400">.</i>
					</h2>
					<p class="mx-auto mt-4 max-w-lg text-lg text-ink-muted">
						Join authorized LGU staff who turn public discourse into verified, actionable
						intelligence.
					</p>
					<div class="mt-10 flex flex-wrap items-center justify-center gap-3">
						<a href="/login" class="btn-primary min-h-11 px-8 py-2.5 text-base">Staff sign in</a>
						<a href="#methodology" class="btn-secondary min-h-11 px-8 py-2.5 text-base"
							>Review the methodology</a
						>
					</div>
				</div>

				<div class="reveal mt-16 border-t border-line pt-10" style="transition-delay: 160ms">
					<span class="font-mono text-[11px] tracking-widest text-ink-faint uppercase">
						built on a modern civic stack
					</span>
					<div class="stack-grid mt-8">
						{#each STACK as tech (tech)}
							<span class="stack-name">{tech}</span>
						{/each}
					</div>
				</div>
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer
		class="mx-auto flex max-w-6xl flex-col items-center gap-2 border-t border-line px-6 py-10 text-center md:flex-row md:justify-between md:px-10 md:text-left"
	>
		<p class="text-sm text-ink-muted">Civic Pulse - Pulilan LGU Intelligence Engine</p>
		<p class="text-xs text-ink-muted">Public prototype overview · Staff access is restricted</p>
	</footer>
</div>

<style>
	.landing-glow {
		background:
			radial-gradient(
				ellipse 60% 45% at 20% 0%,
				color-mix(in srgb, var(--color-signal-600) 8%, transparent) 0%,
				transparent 60%
			),
			radial-gradient(
				ellipse 45% 40% at 85% 20%,
				color-mix(in srgb, var(--color-signal-600) 5%, transparent) 0%,
				transparent 60%
			);
	}

	/* Sweep head — rides the hero ECG trace. The global `.ecg-head` supplies
	   offset-rotate + the 7s ecg-sweep loop; the prefers-reduced-motion block
	   in layout.css freezes it. */
	.hero-pulse :global(.ecg-head) {
		offset-path: var(--ecg-path);
		fill: var(--color-signal-600);
	}

	/* Featured bento sweep head — same loop, bound to the sentiment trace via
	   the per-instance --bento-path set on the chart svg. */
	.featured-chart :global(.bento-sweep) {
		offset-path: var(--bento-path);
		fill: var(--color-signal-600);
	}

	/* Comet trail — a short bright dash that tracks the head. pathLength="100"
	   normalizes the path so the dash math stays in sync with the head's
	   offset-distance (both fraction-of-path over the same 7s linear loop). */
	.hero-pulse .pulse-trail {
		fill: none;
		stroke: var(--color-signal-600);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-dasharray: 8 100;
		animation: pulse-trail 7s linear infinite;
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-signal-600) 55%, transparent));
	}
	@keyframes pulse-trail {
		from {
			stroke-dashoffset: 8;
		}
		to {
			stroke-dashoffset: -92;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-pulse .pulse-trail {
			opacity: 0;
		}
	}
</style>
