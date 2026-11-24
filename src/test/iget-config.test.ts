import { describe, expect, it } from 'vitest';
import { resolveIgetConfig } from '../../supabase/functions/_shared/iget-config';

const configs = [
  { network: 'MTN', api_base_url: 'https://portal.example/api/v1', api_key: 'portal-key' },
  { network: 'Telecel', api_base_url: 'https://telecel.example', api_key: 'shared-key' },
  { network: 'AirtelTigo', api_base_url: 'https://at.example', api_key: 'shared-key' },
];

describe('iGet submission and status routing', () => {
  it('checks MTN references on iGet, never the MTN Portal-02 configuration', () => {
    const config = resolveIgetConfig('MTN', configs, 'fallback-key');
    expect(`${config.api_base_url}/api/developer/orders/reference/FJRLSQ`)
      .toBe('https://iget.onrender.com/api/developer/orders/reference/FJRLSQ');
    expect(config.api_key).toBe('shared-key');
  });
  it('loads the shared account even when only MTN orders are pending', () => {
    expect(resolveIgetConfig('MTN', configs.slice(0, 2)).api_key).toBe('shared-key');
  });
  it('uses AirtelTigo when the Telecel key is absent', () => {
    expect(resolveIgetConfig('MTN', [configs[0], configs[2]]).api_key).toBe('shared-key');
  });
  it('falls back to the backend secret, not the Portal-02 key', () => {
    expect(resolveIgetConfig('MTN', [configs[0]], 'fallback-key').api_key).toBe('fallback-key');
  });
  it('returns no MTN key when only the Portal-02 key exists', () => {
    expect(resolveIgetConfig('MTN', [configs[0]]).api_key).toBe('');
  });
  it('cleans pasted shared keys just like MTN submission', () => {
    expect(resolveIgetConfig('MTN', [{ network: 'Telecel', api_key: ' “shared-\u200bkey”\n' }]).api_key)
      .toBe('shared-key');
  });
  it.each(['Telecel', 'AirtelTigo'])('preserves %s URL and credentials', network => {
    const original = configs.find(c => c.network === network);
    expect(resolveIgetConfig(network, configs, 'fallback-key')).toEqual({
      api_base_url: original?.api_base_url, api_key: 'shared-key',
    });
  });
});