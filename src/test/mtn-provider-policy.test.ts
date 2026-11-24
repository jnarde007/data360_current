import { describe, expect, it } from 'vitest';
import { resolveMtnProvider, validateMtnIgetPurchase, mapMtnIgetStatus, mustHoldMtnSubmission, capacitiesFromCatalog } from '../../supabase/functions/_shared/mtn-provider-policy';

describe('MTN provider safeguards', () => {
  it('uses the saved Portal02 provider, not a later selection', () => {
    expect(resolveMtnProvider({ provider_name: 'Portal-02', provider_routing_version: 1 })).toBe('Portal-02');
  });
  it('uses the saved iGet provider, not a later selection', () => {
    expect(resolveMtnProvider({ provider_name: 'iGet', provider_routing_version: 1 })).toBe('iGet');
  });
  it('keeps unassigned legacy MTN orders on Portal02', () => {
    expect(resolveMtnProvider({ provider_name: '', provider_routing_version: 0 })).toBe('Portal-02');
  });
  it('rejects missing provider on newly pinned orders', () => {
    expect(() => resolveMtnProvider({ provider_name: '', provider_routing_version: 1 })).toThrow();
  });
  const catalog = capacitiesFromCatalog([
    { product: 'Data', size: '1GB' }, { product: 'Data', size: '3GB' }, { product: 'Data', size: '8GB' },
    { product: 'Data', size: '50Gb' }, { product: 'AFA Registration', size: 'Per Registration' },
  ]);
  it('builds allowed sizes from the MTN price list only', () => {
    expect(catalog).toEqual([1, 3, 8, 50]);
  });
  it.each([3, 8, 50])('accepts catalog size %s GB (e.g. 3GB and 8GB)', capacity => {
    expect(() => validateMtnIgetPurchase('0241234567', capacity, 'mtnup2u', catalog)).not.toThrow();
  });
  it.each([2, 7, 0, -1, 1.5])('rejects size %s not in the price list', capacity => {
    expect(() => validateMtnIgetPurchase('0241234567', capacity, 'mtnup2u', catalog)).toThrow();
  });
  it.each(['mtnup2u', 'mtn-justforu', 'mtn-fibre'])('accepts requested type %s', type => {
    expect(() => validateMtnIgetPurchase('0241234567', 1, type, catalog)).not.toThrow();
  });
  it('rejects other networks as MTN bundle types', () => {
    expect(() => validateMtnIgetPurchase('0241234567', 1, 'AT-ishare', catalog)).toThrow();
  });
  it('rejects malformed recipient numbers', () => {
    expect(() => validateMtnIgetPurchase('0241234', 1, 'mtnup2u', catalog)).toThrow();
  });
  it.each(['pending', 'processing', undefined, 'success', 'delivered', 201])('does not deliver on status %s', status => {
    expect(mapMtnIgetStatus(status)).not.toBe('delivered');
  });
  it('delivers only when provider confirms completed', () => {
    expect(mapMtnIgetStatus('completed')).toBe('delivered');
  });
  it('holds uncertain submissions without purchase retry', () => {
    expect(mustHoldMtnSubmission({ provider_submission_uncertain: true })).toBe(true);
  });
  it('holds submissions already started even without returned references', () => {
    expect(mustHoldMtnSubmission({ provider_submission_started_at: '2026-11-03T16:00:00Z' })).toBe(true);
  });
  it('holds orders with provider order IDs even without a reference', () => {
    expect(mustHoldMtnSubmission({ provider_order_id: 'provider-order-123' })).toBe(true);
  });
  it('allows only a fresh submission without provider evidence', () => {
    expect(mustHoldMtnSubmission({})).toBe(false);
  });
});