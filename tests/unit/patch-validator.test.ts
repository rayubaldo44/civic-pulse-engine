import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePatchFields } from '$lib/server/issues';

const validAssignee = vi.fn(async (id: string) => id === 'staff-9');

describe('validatePatchFields', () => {
	beforeEach(() => validAssignee.mockClear());

	it('rejects an illegal status transition with the adjacency-map message', async () => {
		const result = await validatePatchFields(
			{ status: 'Resolved' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result).toEqual({
			patch: {},
			error: { status: 400, message: 'Invalid transition: Open → Resolved' }
		});
	});

	it('accepts a legal transition onto the patch', async () => {
		const result = await validatePatchFields(
			{ status: 'In Progress' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result).toEqual({ patch: { status: 'In Progress' } });
	});

	it('treats a same-status body as a no-op (no error, no patch)', async () => {
		const result = await validatePatchFields({ status: 'Open' }, { status: 'Open' }, validAssignee);
		expect(result).toEqual({
			patch: {},
			error: { status: 400, message: 'No valid fields to update' }
		});
	});

	it('ignores a non-string status value', async () => {
		const result = await validatePatchFields(
			{ status: 42, description: 'x' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.patch).toEqual({ description: 'x' });
	});

	it('rejects priorities outside the whitelist', async () => {
		const result = await validatePatchFields(
			{ priority: 'Urgent' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.error).toEqual({ status: 400, message: 'Invalid priority value' });
	});

	it('keeps a valid priority', async () => {
		const result = await validatePatchFields(
			{ priority: 'Critical' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result).toEqual({ patch: { priority: 'Critical' } });
	});

	it('clears an assignment without consulting the profile store', async () => {
		const result = await validatePatchFields(
			{ assigned_to: null, description: 'loose wire' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.patch).toMatchObject({ assigned_to: null });
		expect(validAssignee).not.toHaveBeenCalled();
	});

	it('validates a string assignee against the injected callback', async () => {
		const result = await validatePatchFields(
			{ assigned_to: 'staff-9' },
			{ status: 'Open' },
			validAssignee
		);
		expect(validAssignee).toHaveBeenCalledOnce();
		expect(validAssignee).toHaveBeenCalledWith('staff-9');
		expect(result).toEqual({ patch: { assigned_to: 'staff-9' } });
	});

	it('rejects an assignee the callback does not recognise', async () => {
		const result = await validatePatchFields(
			{ assigned_to: 'ghost-user' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.error).toEqual({
			status: 400,
			message: 'assigned_to does not reference a valid user'
		});
	});

	it('silently drops non-string, non-null assignee values', async () => {
		const result = await validatePatchFields(
			{ assigned_to: 42, description: 'x' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.patch).not.toHaveProperty('assigned_to');
		expect(result.patch.description).toBe('x');
	});

	it('trims description text before persisting', async () => {
		const result = await validatePatchFields(
			{ description: '  near the school  ' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.patch).toEqual({ description: 'near the school' });
	});

	it('reports when nothing updatable remains', async () => {
		const result = await validatePatchFields({}, { status: 'Open' }, validAssignee);
		expect(result.error).toEqual({ status: 400, message: 'No valid fields to update' });
	});

	it('checks the transition before validating priority', async () => {
		const result = await validatePatchFields(
			{ status: 'Resolved', priority: 'Urgent' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.error?.message).toBe('Invalid transition: Open → Resolved');
	});

	it('validates priority before consulting the assignee callback', async () => {
		const result = await validatePatchFields(
			{ priority: 'Urgent', assigned_to: 'staff-9' },
			{ status: 'Open' },
			validAssignee
		);
		expect(result.error?.message).toBe('Invalid priority value');
		expect(validAssignee).not.toHaveBeenCalled();
	});
});
