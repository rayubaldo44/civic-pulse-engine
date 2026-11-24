import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked before the route module is imported so the fake client is in place
// by the time +page.server.ts resolves its top-level imports.
const { mockSupabase, mockLogAudit, mockBuildDetails } = vi.hoisted(() => {
	const storageUpload = vi.fn().mockResolvedValue({ error: null });
	const single = vi.fn().mockResolvedValue({ data: { id: 'doc-123' }, error: null });
	const select = vi.fn().mockReturnValue({ single });
	const insert = vi.fn().mockReturnValue({ select });
	return {
		mockSupabase: {
			storage: { from: vi.fn().mockReturnValue({ upload: storageUpload }) },
			from: vi.fn().mockReturnValue({ insert })
		},
		mockLogAudit: vi.fn(),
		mockBuildDetails: vi.fn((pairs: Record<string, unknown>) => pairs)
	};
});

vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: () => mockSupabase }));
vi.mock('$lib/server/audit', () => ({
	logAudit: mockLogAudit,
	buildDetails: mockBuildDetails
}));

import { actions } from '../../src/routes/Authenticated/reference-docs/+page.server';
import type { ActionHandler, IssueRouteEvent } from './helpers/api';

// kit brands each route's event type to its exact path, so the action is
// invoked through the loosened ActionHandler shape instead of ./$types.
const uploadDocument = actions.uploadDocument as unknown as ActionHandler;

const USER = { id: 'user-1', email: 'test@example.com' };
const DOC_TYPE = 'Ordinance';

// `fail()` in kit 2 returns an ActionFailure ({ status, data }) — it does not
// throw — so every rejection path resolves. Assert on shape rather than
// isActionFailure(), whose class-identity check breaks when kit is duplicated
// between the test runner and the vite-transformed route module.
async function expectFailure(result: unknown, status: number, data: unknown) {
	await expect(Promise.resolve(result)).resolves.toMatchObject({ status, data });
}

function makeEvent(
	overrides: {
		user?: { id: string; email?: string } | null;
		fields?: Record<string, string | File>;
	} = {}
): IssueRouteEvent {
	const formData = new FormData();
	for (const [key, value] of Object.entries(overrides.fields ?? {})) formData.set(key, value);

	// `in` rather than `??` — an explicit `user: null` means signed out.
	const user = 'user' in overrides ? overrides.user : USER;

	// The action only reads `request.formData()` and `locals`, so the rest of
	// the event is stubbed to satisfy the type rather than to be exercised.
	return {
		request: { formData: async () => formData },
		locals: { safeGetSession: async () => ({ user }), supabase: mockSupabase },
		url: new URL('http://localhost/Authenticated/reference-docs'),
		params: {},
		cookies: {
			set: vi.fn(),
			get: vi.fn(),
			delete: vi.fn(),
			getAll: vi.fn(() => [])
		},
		getClientAddress: () => '127.0.0.1'
	} as unknown as IssueRouteEvent;
}

const validFields = { title: 'Test Document', documentType: DOC_TYPE, content: 'Some content' };

describe('Reference Docs Upload Action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('requires an authenticated user', async () => {
		const event = makeEvent({ user: null });

		await expectFailure(uploadDocument(event), 401, {
			uploadError: 'Session expired. Please log in again.'
		});
		expect(mockSupabase.from).not.toHaveBeenCalled();
		expect(mockSupabase.storage.from).not.toHaveBeenCalled();
	});

	it('requires title', async () => {
		const event = makeEvent({ fields: { ...validFields, title: '   ' } });

		await expectFailure(uploadDocument(event), 400, {
			uploadError: 'Document title is required.',
			field: 'title'
		});
	});

	it('requires document type from allowed list', async () => {
		const event = makeEvent({ fields: { ...validFields, documentType: 'InvalidType' } });

		await expectFailure(uploadDocument(event), 400, {
			uploadError: 'Select a valid document type.',
			field: 'documentType'
		});
	});

	it('requires content', async () => {
		const event = makeEvent({ fields: { ...validFields, content: '' } });

		await expectFailure(uploadDocument(event), 400, {
			uploadError: 'Document content / summary is required.',
			field: 'content'
		});
	});

	it('rejects file types not in ALLOWED_TYPES', async () => {
		const file = new File(['content'], 'test.exe', { type: 'application/x-msdownload' });
		const event = makeEvent({ fields: { ...validFields, file } });

		await expectFailure(uploadDocument(event), 400, {
			uploadError: 'Only PDF, DOCX, and TXT files are allowed.',
			field: 'file'
		});
		expect(mockSupabase.storage.from).not.toHaveBeenCalled();
	});

	it('rejects files larger than 10 MB', async () => {
		const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf', {
			type: 'application/pdf'
		});
		const event = makeEvent({ fields: { ...validFields, file } });

		await expectFailure(uploadDocument(event), 400, {
			uploadError: 'File must be under 10 MB.',
			field: 'file'
		});
		expect(mockSupabase.storage.from).not.toHaveBeenCalled();
	});

	it('stores a PDF attachment and inserts the document row', async () => {
		const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
		const event = makeEvent({ fields: { ...validFields, file } });

		await expect(uploadDocument(event)).resolves.toEqual({ uploadSuccess: true });

		expect(mockSupabase.storage.from).toHaveBeenCalledWith('lgu-documents');
		const [storagePath, bytes, opts] = mockSupabase.storage.from().upload.mock.calls[0];
		// Namespaced under the uploader's UID so uploads cannot collide.
		expect(storagePath).toMatch(new RegExp(`^${USER.id}/\\d{13}\\.pdf$`));
		expect(bytes).toBeInstanceOf(ArrayBuffer);
		expect(opts).toEqual({ contentType: 'application/pdf', upsert: false });

		expect(mockSupabase.from).toHaveBeenCalledWith('lgu_documents');
		const [row] = mockSupabase.from().insert.mock.calls[0];
		expect(row.title).toBe('Test Document');
		expect(row.document_type).toBe(DOC_TYPE);
		expect(row.uploaded_by).toBe(USER.id);
		// The NLP pipeline reads the storage pointer back out of the content.
		expect(row.content).toContain('[attachment:');
		expect(row.content).toContain(storagePath);

		expect(mockLogAudit).toHaveBeenCalledTimes(1);
		expect(mockLogAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'document.create',
				actorId: USER.id,
				resourceId: 'doc-123'
			})
		);
	});

	it('skips storage for a zero-byte file and inserts without an attachment ref', async () => {
		const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
		const event = makeEvent({ fields: { ...validFields, file: empty } });

		await expect(uploadDocument(event)).resolves.toEqual({ uploadSuccess: true });

		expect(mockSupabase.storage.from).not.toHaveBeenCalled();
		const [row] = mockSupabase.from().insert.mock.calls[0];
		expect(row.content).toBe('Some content');
	});
});
