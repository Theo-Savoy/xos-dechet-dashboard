// @vitest-environment node

import { describe, expect, it } from 'vitest';
import middleware, { isAuthBridge, isProtected, isPublic } from './middleware.js';

describe('middleware route classifiers', () => {
  it('treats /api/auth as the public JWT bridge (ex sso-bridge)', () => {
    expect(isAuthBridge('/api/auth')).toBe(true);
    expect(isAuthBridge('/api/sso-bridge')).toBe(true);
    expect(isAuthBridge('/api/calls')).toBe(false);
  });

  it('keeps SPA root public and native APIs protected by default', () => {
    expect(isPublic('/')).toBe(true);
    expect(isPublic('/assets/index.js')).toBe(true);
    expect(isProtected('/api/calls')).toBe(true);
    expect(isProtected('/api/cleaner')).toBe(true);
    expect(isProtected('/api/status')).toBe(true);
  });
});

describe('middleware() runtime', () => {
  it('rejects a protected API route with no Authorization header', async () => {
    const request = new Request('https://xos.hellotheo.fr/api/calls', {
      method: 'POST',
    });
    const response = await middleware(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('lets a protected API route through when Authorization: Bearer *** is present', async () => {
    const request = new Request('https://xos.hellotheo.fr/api/calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-jwt-token' },
    });
    const response = await middleware(request);

    expect(response).toBeUndefined();
  });
});
