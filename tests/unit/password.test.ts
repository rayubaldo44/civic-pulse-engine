import { describe, it, expect } from 'vitest';
import { PASSWORD_MIN_LENGTH, maskEmail, validateNewPassword } from '$lib/utils/password';

describe('PASSWORD_MIN_LENGTH', () => {
	it('is 12', () => {
		expect(PASSWORD_MIN_LENGTH).toBe(12);
	});
});

describe('validateNewPassword', () => {
	const STRONG_1 = 'Str0ng!Passw0rd#';
	const STRONG_UNICODE = 'Passw0rd Unïcode';

	describe('passing cases', () => {
		it('accepts a strong password with matching confirm', () => {
			expect(validateNewPassword(STRONG_1, STRONG_1)).toEqual({ valid: true });
			expect(validateNewPassword(STRONG_1, STRONG_1).error).toBeUndefined();
		});

		it('accepts unicode and space as special characters', () => {
			expect(validateNewPassword(STRONG_UNICODE, STRONG_UNICODE)).toEqual({ valid: true });
		});
	});

	describe('rule: empty password', () => {
		it('rejects empty password with exact error', () => {
			expect(validateNewPassword('', 'anything')).toEqual({
				valid: false,
				error: 'Password is required.'
			});
		});
	});

	describe('rule: minimum length', () => {
		it('rejects an 11-character password even if otherwise strong', () => {
			const pw = 'Ab1!Ab1!Ab1'; // 11 chars, all complexity rules satisfied
			expect(pw.length).toBe(PASSWORD_MIN_LENGTH - 1);
			expect(validateNewPassword(pw, pw)).toEqual({
				valid: false,
				error: 'Password must be at least 12 characters.'
			});
		});

		it('accepts exactly 12 characters', () => {
			const pw = 'Ab1!Ab1!Ab1!'; // 12 chars
			expect(pw.length).toBe(PASSWORD_MIN_LENGTH);
			expect(validateNewPassword(pw, pw)).toEqual({ valid: true });
		});
	});

	describe('rule: lowercase letter', () => {
		it('rejects password with no lowercase letter', () => {
			expect(validateNewPassword('ABCDEFGH12!@', 'ABCDEFGH12!@')).toEqual({
				valid: false,
				error: 'Password must include a lowercase letter.'
			});
		});
	});

	describe('rule: uppercase letter', () => {
		it('rejects password with no uppercase letter', () => {
			expect(validateNewPassword('abcdefgh123!', 'abcdefgh123!')).toEqual({
				valid: false,
				error: 'Password must include an uppercase letter.'
			});
		});
	});

	describe('rule: digit', () => {
		it('rejects password with no digit', () => {
			expect(validateNewPassword('Abcdefghijk!', 'Abcdefghijk!')).toEqual({
				valid: false,
				error: 'Password must include a number.'
			});
		});
	});

	describe('rule: special character', () => {
		it('rejects purely alphanumeric password', () => {
			expect(validateNewPassword('Abcdefghij12', 'Abcdefghij12')).toEqual({
				valid: false,
				error: 'Password must include a special character.'
			});
		});
	});

	describe('rule: confirmation match', () => {
		it('rejects mismatched confirmation', () => {
			expect(validateNewPassword(STRONG_1, 'Str0ng!Passw0rd$')).toEqual({
				valid: false,
				error: 'Passwords do not match.'
			});
		});
	});

	describe('check order', () => {
		it('empty beats mismatch', () => {
			expect(validateNewPassword('', 'different').error).toBe('Password is required.');
		});

		it('length beats complexity and mismatch', () => {
			expect(validateNewPassword('short', 'totally different').error).toBe(
				'Password must be at least 12 characters.'
			);
		});

		it('length beats missing lowercase', () => {
			expect(validateNewPassword('ABCDEFGHIJ', 'ABCDEFGHIJ').error).toBe(
				'Password must be at least 12 characters.'
			);
		});

		it('lowercase beats uppercase and mismatch', () => {
			expect(validateNewPassword('ABCDEFGHIJ1!', 'zzzzzzzzzzz').error).toBe(
				'Password must include a lowercase letter.'
			);
		});

		it('uppercase beats digit', () => {
			expect(validateNewPassword('abcdefghijklm!', 'abcdefghijklm!').error).toBe(
				'Password must include an uppercase letter.'
			);
		});

		it('digit beats special character', () => {
			expect(validateNewPassword('Abcdefghijklmn', 'Abcdefghijklmn').error).toBe(
				'Password must include a number.'
			);
		});

		it('special character beats confirmation match', () => {
			expect(validateNewPassword('Abcdefghij12', 'Different123!').error).toBe(
				'Password must include a special character.'
			);
		});
	});
});

describe('maskEmail', () => {
	it('keeps first 2 local chars, masks the rest, keeps full domain', () => {
		expect(maskEmail('juan.delacruz@pulilan.gov.ph')).toBe(
			'ju' + '•'.repeat(11) + '@pulilan.gov.ph'
		);
	});

	it('masks a 3-character local part down to first char + bullet (general rule)', () => {
		expect(maskEmail('abc@pulilan.gov.ph')).toBe('ab•@pulilan.gov.ph');
	});

	it('handles 2-character local part by keeping only the first character', () => {
		expect(maskEmail('ab@pulilan.gov.ph')).toBe('a•@pulilan.gov.ph');
	});

	it('single-character local part has nothing to mask', () => {
		expect(maskEmail('j@gov.ph')).toBe('j@gov.ph');
	});

	it('returns placeholder for empty string', () => {
		expect(maskEmail('')).toBe('your email');
	});

	it('returns placeholder when there is no @', () => {
		expect(maskEmail('nodomain')).toBe('your email');
	});

	it('returns placeholder for empty local part', () => {
		expect(maskEmail('@domain.com')).toBe('your email');
	});

	it('returns placeholder for empty domain', () => {
		expect(maskEmail('user@')).toBe('your email');
	});
});
