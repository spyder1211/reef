import { describe, expect, it } from 'vitest'
import { SshTunnel } from './SshTunnel'

describe('SshTunnel', () => {
  it('到達不能ホストでは open が reject される', async () => {
    const tunnel = new SshTunnel()
    await expect(
      tunnel.open(
        {
          enabled: true,
          host: '127.0.0.1',
          port: 1,
          user: 'x',
          authMethod: 'password',
          password: 'x'
        },
        'db.example.com',
        3306
      )
    ).rejects.toThrow()
  }, 15_000)

  it('open していなくても close は安全に呼べる', async () => {
    await expect(new SshTunnel().close()).resolves.toBeUndefined()
  })
})
