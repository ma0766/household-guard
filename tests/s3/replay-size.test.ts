import { expect, it } from 'vitest';
import { CASES } from '../replay/cases.js';

it('replay is at 20 cases by S3', () => expect(CASES.length).toBeGreaterThanOrEqual(20));
