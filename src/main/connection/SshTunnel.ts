import { readFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'
import type { SshSettings } from '../../shared/types'

// SSH トンネル: 127.0.0.1 の空きポートで listen し、着信ソケットを
// ssh forwardOut で (dbHost:dbPort) へ中継する。mysql2 プールの複数接続にも対応。
export class SshTunnel {
  private client: Client | null = null
  private server: Server | null = null

  // トンネルを開き、mysql2 が接続すべきローカルポート番号を返す。
  async open(ssh: SshSettings, dbHost: string, dbPort: number): Promise<number> {
    const client = new Client()
    const config: ConnectConfig = {
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      readyTimeout: 10_000
    }
    if (ssh.authMethod === 'password') {
      config.password = ssh.password ?? ''
    } else {
      config.privateKey = readFileSync(ssh.privateKeyPath ?? '')
      if (ssh.passphrase) config.passphrase = ssh.passphrase
    }

    await new Promise<void>((resolve, reject) => {
      client.once('ready', () => resolve())
      client.once('error', (err) => reject(err))
      client.connect(config)
    })
    this.client = client

    const server = createServer((socket: Socket) => {
      client.forwardOut(
        socket.remoteAddress ?? '127.0.0.1',
        socket.remotePort ?? 0,
        dbHost,
        dbPort,
        (err, stream) => {
          if (err) {
            socket.destroy()
            return
          }
          socket.pipe(stream).pipe(socket)
          stream.on('error', () => socket.destroy())
          socket.on('error', () => stream.destroy())
        }
      )
    })
    this.server = server

    return new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('Failed to bind local tunnel port'))
      })
    })
  }

  async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()))
      this.server = null
    }
    if (this.client) {
      this.client.end()
      this.client = null
    }
  }

  isOpen(): boolean {
    return this.client !== null
  }
}
