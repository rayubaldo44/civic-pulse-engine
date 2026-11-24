import { describe, expect, it } from 'vitest';
import { normalizeTopic } from '../../supabase/functions/support/topic';

describe('normalizeTopic (edge support/topic.ts)', () => {
	it('passes canonical topics through unchanged', () => {
		expect(normalizeTopic('Infrastructure')).toBe('Infrastructure');
		expect(normalizeTopic('Healthcare')).toBe('Healthcare');
		expect(normalizeTopic('Waste Management')).toBe('Waste Management');
		expect(normalizeTopic('Public Safety')).toBe('Public Safety');
		expect(normalizeTopic('Other')).toBe('Other');
	});

	it('maps observed NLP compound variants onto canonical topics', () => {
		expect(normalizeTopic('Public Safety and Peace and Order')).toBe('Public Safety');
		expect(normalizeTopic('Infrastructure and Public Works')).toBe('Infrastructure');
		expect(normalizeTopic('Healthcare and Medical Services')).toBe('Healthcare');
		expect(normalizeTopic('Health Services')).toBe('Healthcare');
		expect(normalizeTopic('Waste Management and Sanitation')).toBe('Waste Management');
	});

	it('is case-insensitive for both canonical values and aliases', () => {
		expect(normalizeTopic('  infrastructure ')).toBe('Infrastructure');
		expect(normalizeTopic('HEALTH SERVICES')).toBe('Healthcare');
	});

	it('folds unknown labels, whitespace, and nulls into Other', () => {
		expect(normalizeTopic('Local Governance')).toBe('Other');
		expect(normalizeTopic('   ')).toBe('Other');
		expect(normalizeTopic('')).toBe('Other');
		expect(normalizeTopic(null)).toBe('Other');
		expect(normalizeTopic(undefined)).toBe('Other');
	});
});
