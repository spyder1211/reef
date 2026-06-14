import { useState, useEffect, type ReactNode } from 'react'
import type {
  AppError,
  ConnectionProfileInput,
  ConnectionTag,
  SshSettings
} from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { TAG_ORDER, TAG_COLORS, TAG_LABELS } from '../lib/tags'
import styles from './ConnectionFormModal.module.css'

function initialForm(): ConnectionProfileInput {
  return { name: '', tag: 'local', host: '127.0.0.1', port: 3306, user: 'root', password: '', database: '' }
}

// SSH 設定の既定値（チェックボックス ON 時の初期状態）。
function defaultSsh(): SshSettings {
  return {
    enabled: true,
    host: '',
    port: 22,
    user: '',
    authMethod: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: ''
  }
}

export default function ConnectionFormModal(): JSX.Element {
  const editingId = useAppStore((s) => s.editingId)
  const profiles = useAppStore((s) => s.profiles)
  const closeForm = useAppStore((s) => s.closeForm)
  const saveProfile = useAppStore((s) => s.saveProfile)
  const connect = useAppStore((s) => s.connect)

  const editing = profiles.find((p) => p.id === editingId) ?? null
  const [form, setForm] = useState<ConnectionProfileInput>(() =>
    editing ? { ...editing, password: '' } : initialForm()
  )
  const [error, setError] = useState<AppError | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok'>('idle')
  // safeStorage が使えない環境（暗号化不可）では認証情報を保存できない旨を注記する。
  // 既定 true = 注記を出さない（取得できた場合のみ false で注記）。
  const [encAvailable, setEncAvailable] = useState(true)
  useEffect(() => {
    void window.api.connections.isEncryptionAvailable().then((res) => {
      if (res.ok) setEncAvailable(res.data)
    })
  }, [])

  function update<K extends keyof ConnectionProfileInput>(key: K, value: ConnectionProfileInput[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
    setTestState('idle')
  }

  // SSH 設定の更新。未設定なら既定値から作る。
  function updateSsh<K extends keyof SshSettings>(key: K, value: SshSettings[K]): void {
    setForm((f) => ({ ...f, ssh: { ...(f.ssh ?? defaultSsh()), [key]: value } }))
    setTestState('idle')
  }

  async function handlePickKey(): Promise<void> {
    const res = await window.api.pickPrivateKey()
    if (res.ok && !res.data.canceled && res.data.filePath) {
      updateSsh('privateKeyPath', res.data.filePath)
    }
  }

  const ssh = form.ssh

  async function handleSave(): Promise<void> {
    setError(null)
    const res = await saveProfile(form)
    if (res.ok) closeForm()
    else setError(res.error)
  }

  async function handleConnect(): Promise<void> {
    setError(null)
    const res = await saveProfile(form)
    if (!res.ok) {
      setError(res.error)
      return
    }
    closeForm()
    await connect(res.data)
  }

  async function handleTest(): Promise<void> {
    setError(null)
    setTestState('testing')
    const res = await window.api.connect({
      host: form.host,
      port: form.port,
      user: form.user,
      password: form.password,
      database: form.database,
      ssh: form.ssh
    })
    if (res.ok) {
      setTestState('ok')
      await window.api.disconnect()
    } else {
      setTestState('idle')
      setError(res.error)
    }
  }

  return (
    <div className={styles.backdrop} onClick={closeForm}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>MySQL 接続</div>

        <Field label="名前">
          <input className={styles.input} value={form.name} onChange={(e) => update('name', e.target.value)} autoFocus />
        </Field>

        <Field label="タグ">
          <div className={styles.swatches}>
            {TAG_ORDER.map((t) => {
              const selected = form.tag === t
              return (
                <button
                  key={t}
                  type="button"
                  className={`${styles.tagOption} ${selected ? styles.tagSelected : ''}`}
                  style={selected ? { borderColor: TAG_COLORS[t], color: TAG_COLORS[t] } : undefined}
                  onClick={() => update('tag', t as ConnectionTag)}
                >
                  <span className={styles.tagDot} style={{ background: TAG_COLORS[t] }} />
                  {TAG_LABELS[t] || 'なし'}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Host">
          <input className={styles.input} value={form.host} onChange={(e) => update('host', e.target.value)} />
          <input
            className={styles.port}
            type="number"
            value={form.port}
            onChange={(e) => update('port', Number(e.target.value))}
          />
        </Field>

        <Field label="User">
          <input className={styles.input} value={form.user} onChange={(e) => update('user', e.target.value)} />
        </Field>

        <Field label="Password">
          <input
            className={styles.input}
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>

        {!encAvailable && (
          <div className={styles.encWarn}>
            この環境では認証情報（パスワード・SSH 秘匿値）を暗号化保存できないため、保存されません。
          </div>
        )}

        <Field label="Database">
          <input
            className={styles.input}
            value={form.database ?? ''}
            onChange={(e) => update('database', e.target.value)}
          />
        </Field>

        <Field label="SSH トンネル">
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={ssh?.enabled ?? false}
              onChange={(e) => updateSsh('enabled', e.target.checked)}
            />
            踏み台（bastion）経由で接続する
          </label>
        </Field>

        {ssh?.enabled && (
          <>
            <Field label="SSH Host">
              <input
                className={styles.input}
                value={ssh.host}
                onChange={(e) => updateSsh('host', e.target.value)}
                placeholder="bastion.example.com"
              />
              <input
                className={styles.port}
                type="number"
                value={ssh.port}
                onChange={(e) => updateSsh('port', Number(e.target.value))}
              />
            </Field>

            <Field label="SSH User">
              <input
                className={styles.input}
                value={ssh.user}
                onChange={(e) => updateSsh('user', e.target.value)}
                placeholder="ec2-user"
              />
            </Field>

            <Field label="認証方法">
              <div className={styles.radioRow}>
                <label className={styles.checkRow}>
                  <input
                    type="radio"
                    name="sshAuth"
                    checked={ssh.authMethod === 'password'}
                    onChange={() => updateSsh('authMethod', 'password')}
                  />
                  パスワード
                </label>
                <label className={styles.checkRow}>
                  <input
                    type="radio"
                    name="sshAuth"
                    checked={ssh.authMethod === 'privateKey'}
                    onChange={() => updateSsh('authMethod', 'privateKey')}
                  />
                  秘密鍵
                </label>
              </div>
            </Field>

            {ssh.authMethod === 'password' ? (
              <Field label="SSH Password">
                <input
                  className={styles.input}
                  type="password"
                  value={ssh.password ?? ''}
                  placeholder={editing ? '（変更しない場合は空欄）' : ''}
                  onChange={(e) => updateSsh('password', e.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="秘密鍵">
                  <input
                    className={styles.input}
                    value={ssh.privateKeyPath ?? ''}
                    onChange={(e) => updateSsh('privateKeyPath', e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                  />
                  <button type="button" className={styles.btn} onClick={() => void handlePickKey()}>
                    選択…
                  </button>
                </Field>
                <Field label="パスフレーズ">
                  <input
                    className={styles.input}
                    type="password"
                    value={ssh.passphrase ?? ''}
                    placeholder={editing ? '（変更しない場合は空欄）' : '（任意）'}
                    onChange={(e) => updateSsh('passphrase', e.target.value)}
                  />
                </Field>
              </>
            )}
          </>
        )}

        <div className={styles.note}>SSL は今後対応</div>

        {error && (
          <div className={styles.error}>
            <b>{error.code}</b>: {error.message}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.btn} onClick={() => void handleSave()}>
            保存
          </button>
          <button className={styles.btn} onClick={() => void handleTest()}>
            {testState === 'testing' ? 'テスト中…' : testState === 'ok' ? '✓ 成功' : 'テスト'}
          </button>
          <button className={styles.btnPrimary} onClick={() => void handleConnect()}>
            接続
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className={styles.field}>
      <div className={styles.flabel}>{label}</div>
      <div className={styles.fbody}>{children}</div>
    </div>
  )
}
