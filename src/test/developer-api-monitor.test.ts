import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { endpointLabel, outcomeBucket } from '../../supabase/functions/developer-api/monitor';

describe('Phase 9 monitoring labels', () => {
  it('maps every endpoint to a fixed label', () => {
    expect(endpointLabel('/v1/auth/verify', 'GET', null)).toBe('verify');
    expect(endpointLabel('/v1/packages', 'GET', null)).toBe('packages');
    expect(endpointLabel('/v1/wallet', 'GET', null)).toBe('wallet');
    expect(endpointLabel('/v1/purchases', 'POST', null)).toBe('purchase_create');
    expect(endpointLabel('/v1/purchases', 'GET', null)).toBe('purchase_list');
    expect(endpointLabel('/v1/usage', 'GET', null)).toBe('usage');
    expect(endpointLabel('/v1/usage/history', 'GET', null)).toBe('usage_history');
  });
  it('never keeps the order reference from a lookup path', () => {
    expect(endpointLabel('/v1/purchases/ORD-1234', 'GET', 'ORD-1234')).toBe('purchase_get');
  });
  it('ignores unknown routes', () => {
    expect(endpointLabel('/v1/nope', 'GET', null)).toBeNull();
  });
  it('buckets statuses', () => {
    expect(outcomeBucket(200)).toBe('2xx');
    expect(outcomeBucket(402)).toBe('402');
    expect(outcomeBucket(418)).toBe('4xx');
    expect(outcomeBucket(503)).toBe('5xx');
  });
  it('monitor writes no key, hash, header, body or phone', () => {
    const src = readFileSync('supabase/functions/developer-api/index.ts', 'utf8');
    const rec = src.slice(src.indexOf('async function recordRequest'));
    expect(rec).not.toMatch(/Authorization|key_hash|sha256|recipient|req\.json|phone/i);
  });
  it('blocking is not implemented (no 429 responses)', () => {
    const src = readFileSync('supabase/functions/developer-api/index.ts', 'utf8');
    expect(src).not.toMatch(/,\s*429\b/);
  });
});
