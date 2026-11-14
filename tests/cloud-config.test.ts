import { describe, expect, it } from 'vitest';
import { validateCloudConfig } from '../src/config/cloud';

// Deliberately synthetic, nonfunctional fixtures; no project credentials are read.
const publicFixture = 'sb_publishable_not_a_real_key_12345';
const url = 'https://example-project.supabase.co';

describe('browser cloud configuration boundary', () => {
  it('accepts a publishable key at one HTTPS Supabase project origin', () => {
    expect(validateCloudConfig({ url, publishableKey: publicFixture })).toEqual({ url, publishableKey: publicFixture });
    expect(validateCloudConfig({ url: `${url}/`, publishableKey: publicFixture })).toEqual({ url, publishableKey: publicFixture });
    expect(validateCloudConfig({ url: 'https://example-project.supabase.co:443', publishableKey: publicFixture })).toEqual({ url, publishableKey: publicFixture });
  });

  it('rejects every nonpublishable key format at the browser boundary', () => {
    for (const publishableKey of ['', 'sb_publishable_short', 'sb_secret_fixture_not_a_real_key', 'eyJhbGciOiJIUzI1NiJ9.fixture.signature', publicFixture + '\n']) {
      expect(validateCloudConfig({ url, publishableKey })).toBeNull();
    }
  });

  it('rejects lookalike origins and insecure or nondefault protocols/ports', () => {
    for (const badUrl of [
      'http://example-project.supabase.co',
      'https://example-project.supabase.co:8443',
      'https://example-project.supabase.co.attacker.example',
      'https://supabase.co',
      'https://.supabase.co',
      'https://nested.example-project.supabase.co',
      'data:text/plain,example-project.supabase.co',
    ]) expect(validateCloudConfig({ url: badUrl, publishableKey: publicFixture })).toBeNull();
  });

  it('rejects embedded credentials, query strings, fragments and resource paths', () => {
    for (const badUrl of [
      'https://user:password@example-project.supabase.co',
      `${url}?token=fixture`,
      `${url}#fixture`,
      `${url}/auth/v1`,
    ]) expect(validateCloudConfig({ url: badUrl, publishableKey: publicFixture })).toBeNull();
  });

  it('rejects malformed payloads without throwing or returning partial configuration', () => {
    for (const input of [undefined, null, false, 1, [], '', {}, { url }, { publishableKey: publicFixture }, { url: 7, publishableKey: publicFixture }]) {
      expect(validateCloudConfig(input)).toBeNull();
    }
  });
});
