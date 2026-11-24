import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { seedDatabase } from '../shared/seed';
import { getLocalSupabase, TEST_ADMIN, TEST_ANALYST } from '../shared/supabase-env';
import { analystClient, adminClient } from './helpers/clients';

beforeAll(async () => {
	await seedDatabase();
});

const local = getLocalSupabase();

function decodeJwt(token: string): Record<string, any> {
	const payload = token.split('.')[1];
	const json = Buffer.from(payload, 'base64url').toString('utf8');
	return JSON.parse(json) as Record<string, any>;
}

describe('Authentication against the real GoTrue/Auth stack', () => {
	it('seeded admin signs in with the correct role claim', async () => {
		const { role, userId } = await adminClient();
		expect(role).toBe('admin');
		expect(userId).toBeTruthy();
	});

	it('seeded analyst signs in with the analyst role claim', async () => {
		const { role } = await analystClient();
		expect(role).toBe('analyst');
	});

	it('access token embeds app_metadata.role (role-gating source)', async () => {
		// One-shot client: no background auto-refresh ticker (see clients.ts).
		const supabase = createClient(local.url, local.anonKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const { data } = await supabase.auth.signInWithPassword({
			email: TEST_ANALYST.email,
			password: TEST_ANALYST.password
		});
		const claims = decodeJwt(data.session!.access_token);
		expect(claims.app_metadata?.role).toBe('analyst');
		// The /Authenticated layout resolves role from app_metadata — must be present.
		expect(claims.app_metadata?.role).toEqual(TEST_ANALYST.role);
	});

	it('seeded profiles have password_set = true (first-time setup done)', async () => {
		const { client, userId } = await analystClient();
		const { data } = await (client.from('profiles') as any)
			.select('password_set')
			.eq('id', userId)
			.single();
		expect(data.password_set).toBe(true);
	});

	it('wrong password is rejected with a generic error', async () => {
		const supabase = createClient(local.url, local.anonKey);
		const { error } = await supabase.auth.signInWithPassword({
			email: TEST_ADMIN.email,
			password: 'definitely-wrong'
		});
		expect(error).toBeTruthy();
	});

	it('admin can read its own profile through the authenticated client', async () => {
		const admin = await adminClient();
		const { data } = await (admin.client.from('profiles') as any)
			.select('full_name, role')
			.eq('id', admin.userId)
			.single();
		expect(data.full_name).toBe(TEST_ADMIN.name);
		expect(data.role).toBe('admin');
	});
});
