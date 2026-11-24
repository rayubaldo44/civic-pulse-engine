import { seedDatabase } from '../shared/seed';

// Runs once before the whole integration suite. Individual files re-seed in
// their own beforeAll so each suite sees a deterministic dataset.
export default async function (): Promise<void> {
	await seedDatabase();
}
