// mysql2 のフィールド型コード → 表示用の型名。未知コードは `type<code>`。
const NAMES: Record<number, string> = {
  0: 'decimal',
  1: 'tiny',
  2: 'short',
  3: 'long',
  4: 'float',
  5: 'double',
  6: 'null',
  7: 'timestamp',
  8: 'longlong',
  9: 'int24',
  10: 'date',
  11: 'time',
  12: 'datetime',
  13: 'year',
  14: 'newdate',
  15: 'varchar',
  16: 'bit',
  245: 'json',
  246: 'newdecimal',
  247: 'enum',
  248: 'set',
  249: 'tiny_blob',
  250: 'medium_blob',
  251: 'long_blob',
  252: 'blob',
  253: 'var_string',
  254: 'string',
  255: 'geometry'
}

export function fieldTypeName(code: number): string {
  return NAMES[code] ?? `type${code}`
}
