import { ConnectionManager } from './ConnectionManager'
import { SshTunnel } from './SshTunnel'
import type { ConnectionConfig } from '../../shared/types'

// 現在アクティブな SSH トンネルを保持する共有ホルダ。
// connect / disconnect ハンドラ間で同一インスタンスを共有する。
export interface TunnelHolder {
  current: SshTunnel | null
}

// ssh.enabled ならトンネルを張ってから 127.0.0.1:localPort へ接続する。
// 既存トンネルがあれば先に閉じる。トンネルは holder に保持し、切断時に closeTunnel で閉じる。
export async function connectWithTunnel(
  manager: ConnectionManager,
  config: ConnectionConfig,
  holder: TunnelHolder
): Promise<void> {
  // 再接続に備え、前回のトンネルが残っていれば閉じる。
  await holder.current?.close()
  holder.current = null

  if (!config.ssh?.enabled) {
    await manager.connect(config)
    return
  }

  const tunnel = new SshTunnel()
  try {
    const localPort = await tunnel.open(config.ssh, config.host, config.port)
    await manager.connect({ ...config, host: '127.0.0.1', port: localPort })
    holder.current = tunnel
  } catch (err) {
    await tunnel.close() // 接続失敗時にトンネルを残さない
    // SSH 段階の失敗は DB エラーと区別できるよう明示メッセージに変換する。
    const message = err instanceof Error ? err.message : String(err)
    throw { code: 'SSH_TUNNEL_FAILED', message: `SSH トンネル接続に失敗しました: ${message}` }
  }
}

// アクティブなトンネルを閉じる（切断・接続一覧へ戻る時に呼ぶ）。
export async function closeTunnel(holder: TunnelHolder): Promise<void> {
  await holder.current?.close()
  holder.current = null
}
