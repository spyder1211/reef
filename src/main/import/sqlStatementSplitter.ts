// SQL ダンプを statement 単位に分割するインクリメンタル splitter。
// 文字列リテラル（'...' "..."）・識別子（`...`）・コメント（-- / # / 行末、/* */）内の
// ; は区切りとして扱わない。コメントは出力から除去する。
// 各 statement は trim 済み・末尾 ; なし。空や空白/コメントのみは返さない。
//
// チャンク境界対策: \ エスケープ・-- /* */・連続クォートなど「次の1文字を見ないと
// 確定できない」トークンがチャンク末尾に来た場合、その1文字を carry に退避して次チャンクの
// 先頭へ繰り越す。これによりチャンクの切れ目で2文字トークンが分断されても破綻しない。

type Mode = 'normal' | 'single' | 'double' | 'backtick' | 'line' | 'block'

export class SqlStatementSplitter {
  private buf = ''
  private mode: Mode = 'normal'
  private bomStripped = false
  private carry = '' // 次チャンク先頭へ繰り越す未確定の1文字

  // チャンクを与え、完成した statement の配列を返す（残りは内部バッファ/carry に保持）。
  push(chunk: string): string[] {
    let s = this.carry + chunk
    this.carry = ''
    if (!this.bomStripped) {
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
      this.bomStripped = true
    }
    const out: string[] = []
    this.run(s, out, true)
    return out
  }

  // 末尾の残りを flush する（末尾 ; が無い最終文用）。carry も確定処理する。
  end(): string[] {
    const out: string[] = []
    if (this.carry) {
      const s = this.carry
      this.carry = ''
      this.run(s, out, false)
    }
    this.emit(out)
    return out
  }

  // 現在のモードで、この文字が「次の1文字を見ないと確定できない」トークンの先頭か。
  private isDeferrable(c: string): boolean {
    switch (this.mode) {
      case 'normal':
        return c === '-' || c === '/'
      case 'single':
        return c === '\\' || c === "'"
      case 'double':
        return c === '\\' || c === '"'
      case 'backtick':
        return c === '`'
      case 'block':
        return c === '*'
      default:
        return false
    }
  }

  // s を1文字ずつ処理する。allowDefer=true のとき、末尾の未確定2文字トークンは carry へ繰り越す。
  private run(s: string, out: string[], allowDefer: boolean): void {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      // チャンク末尾の2文字トークン先頭は次チャンクへ繰り越す。
      if (allowDefer && i === s.length - 1 && this.isDeferrable(c)) {
        this.carry = c
        return
      }
      const next = i + 1 < s.length ? s[i + 1] : ''
      switch (this.mode) {
        case 'normal':
          if (c === "'") {
            this.mode = 'single'
            this.buf += c
          } else if (c === '"') {
            this.mode = 'double'
            this.buf += c
          } else if (c === '`') {
            this.mode = 'backtick'
            this.buf += c
          } else if (c === '#') {
            this.mode = 'line'
          } else if (
            c === '-' &&
            next === '-' &&
            (i + 2 >= s.length || /\s/.test(s[i + 2] ?? ' '))
          ) {
            // "--" の後ろが空白/EOL/EOF のときだけ行コメント（MySQL 準拠）
            this.mode = 'line'
            i++ // 2 文字目の "-" を消費
          } else if (c === '/' && next === '*') {
            this.mode = 'block'
            i++ // "*" を消費
          } else if (c === ';') {
            this.emit(out)
          } else {
            this.buf += c
          }
          break
        case 'single':
        case 'double': {
          const q = this.mode === 'single' ? "'" : '"'
          this.buf += c
          if (c === '\\') {
            // 次の 1 文字をエスケープとして取り込む
            if (next) {
              this.buf += next
              i++
            }
          } else if (c === q) {
            if (next === q) {
              // '' や "" の連続はリテラル内
              this.buf += next
              i++
            } else {
              this.mode = 'normal'
            }
          }
          break
        }
        case 'backtick':
          // バッククォート識別子は \\ エスケープ無し。`` の連続でエスケープ。
          this.buf += c
          if (c === '`') {
            if (next === '`') {
              this.buf += next
              i++
            } else {
              this.mode = 'normal'
            }
          }
          break
        case 'line':
          // 改行までコメント。改行は残してトークンが繋がらないようにする。
          if (c === '\n') {
            this.mode = 'normal'
            this.buf += c
          }
          break
        case 'block':
          if (c === '*' && next === '/') {
            this.mode = 'normal'
            i++ // "/" を消費
          }
          break
      }
    }
  }

  private emit(out: string[]): void {
    const stmt = this.buf.trim()
    this.buf = ''
    if (stmt.length > 0) out.push(stmt)
  }
}
