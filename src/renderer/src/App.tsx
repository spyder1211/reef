import { useState, type ChangeEvent } from 'react'
import type { ConnectionConfig, QueryResult, AppError } from '../../shared/types'

export default function App() {
  const [config, setConfig] = useState<ConnectionConfig>({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: ''
  })
  const [connected, setConnected] = useState(false)
  const [sql, setSql] = useState('SELECT 1 AS one')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  async function handleConnect(): Promise<void> {
    setError(null)
    const res = await window.api.connect(config)
    if (res.ok) setConnected(true)
    else setError(res.error)
  }

  async function handleRun(): Promise<void> {
    setError(null)
    const res = await window.api.query(sql)
    if (res.ok) setResult(res.data)
    else setError(res.error)
  }

  const set =
    (k: keyof ConnectionConfig) =>
    (e: ChangeEvent<HTMLInputElement>): void =>
      setConfig({ ...config, [k]: k === 'port' ? Number(e.target.value) : e.target.value })

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h2>MySQL Client (Foundation)</h2>

      <fieldset style={{ marginBottom: 12 }}>
        <legend>接続</legend>
        <input placeholder="host" value={config.host} onChange={set('host')} />
        <input
          placeholder="port"
          type="number"
          value={config.port}
          onChange={set('port')}
          style={{ width: 80 }}
        />
        <input placeholder="user" value={config.user} onChange={set('user')} />
        <input
          placeholder="password"
          type="password"
          value={config.password}
          onChange={set('password')}
        />
        <input placeholder="database" value={config.database ?? ''} onChange={set('database')} />
        <button onClick={handleConnect}>接続</button>
        <span style={{ marginLeft: 8 }}>{connected ? '🟢 接続済み' : '⚪ 未接続'}</span>
      </fieldset>

      <div style={{ marginBottom: 12 }}>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={4}
          style={{ width: '100%', fontFamily: 'monospace' }}
        />
        <button onClick={handleRun} disabled={!connected}>
          実行
        </button>
      </div>

      {error && (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>
          <b>{error.code}</b>: {error.message}
        </div>
      )}

      {result && (
        <div>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>
            {result.rowCount} 行 · {result.durationMs}ms
          </div>
          <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c.name}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {result.columns.map((c) => (
                    <td key={c.name}>{row[c.name] === null ? <i>NULL</i> : String(row[c.name])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
