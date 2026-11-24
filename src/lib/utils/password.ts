export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordValidation {
	valid: boolean;
	error?: string;
}

/**
 * Validates a new password against the security policy.
 * Rules are checked in order and the first failure is returned,
 * so callers can rely on deterministic error messages.
 */
export function validateNewPassword(password: string, confirmPassword: string): PasswordValidation {
	if (!password) {
		return { valid: false, error: 'Password is required.' };
	}
	if (password.length < PASSWORD_MIN_LENGTH) {
		return {
			valid: false,
			error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
		};
	}
	if (!/[a-z]/.test(password)) {
		return { valid: false, error: 'Password must include a lowercase letter.' };
	}
	if (!/[A-Z]/.test(password)) {
		return { valid: false, error: 'Password must include an uppercase letter.' };
	}
	if (!/\d/.test(password)) {
		return { valid: false, error: 'Password must include a number.' };
	}
	if (!/[^A-Za-z0-9]/.test(password)) {
		return { valid: false, error: 'Password must include a special character.' };
	}
	if (password !== confirmPassword) {
		return { valid: false, error: 'Passwords do not match.' };
	}
	return { valid: true };
}

/**
 * Masks the local part of an email for safe display.
 * Keeps the full domain visible; malformed inputs return a generic placeholder
 * so nothing about the account shape leaks.
 */
export function maskEmail(email: string): string {
	const atIndex = email.indexOf('@');
	const local = atIndex === -1 ? '' : email.slice(0, atIndex);
	const domain = atIndex === -1 ? '' : email.slice(atIndex + 1);

	if (!local || !domain) return 'your email';

	const visibleCount = local.length < 3 ? 1 : 2;
	const masked = local.slice(0, visibleCount) + '\u2022'.repeat(local.length - visibleCount);
	return `${masked}@${domain}`;
}
