import { z } from 'zod'
import { AuthSessionSchema, CliDeviceAuthorizationSchema, CliIdentitySchema } from './contract/index.js'
import { CorevelosClient } from './client.js'

/** First-party WorkOS AuthKit sessions through the platform's verified boundary. */
export class Auth {
  constructor(private readonly client: CorevelosClient) {}
  authorizeDevice(signal?: AbortSignal) {
    return this.client.request(CliDeviceAuthorizationSchema, {
      method: 'POST',
      path: '/api/v1/auth/cli/device',
      signal,
    })
  }
  exchangeDevice(deviceCode: string, signal?: AbortSignal) {
    return this.client.request(AuthSessionSchema, {
      method: 'POST',
      path: '/api/v1/auth/cli/token',
      body: { grantType: 'device_code', deviceCode },
      signal,
    })
  }
  refresh(refreshToken: string, organizationId?: string, signal?: AbortSignal) {
    return this.client.request(AuthSessionSchema, {
      method: 'POST',
      path: '/api/v1/auth/cli/token',
      body: { grantType: 'refresh_token', refreshToken, ...(organizationId === undefined ? {} : { organizationId }) },
      signal,
    })
  }
  me(signal?: AbortSignal) {
    return this.client.request(CliIdentitySchema, { path: '/api/v1/auth/cli/me', signal })
  }
  logout(signal?: AbortSignal) {
    return this.client.request(z.object({ accepted: z.literal(true) }), {
      method: 'POST',
      path: '/api/v1/auth/cli/logout',
      signal,
    })
  }
}
