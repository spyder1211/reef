import { open } from 'node:fs/promises'

/** Buffer 先頭が gzip マジックバイト（0x1f 0x8b）か。2バイト未満は false。 */
export function isGzipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

/** ファイル先頭2バイトだけ読んで gzip かを判定する。 */
export async function isGzipFile(filePath: string): Promise<boolean> {
  const fh = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(2)
    const { bytesRead } = await fh.read(buf, 0, 2, 0)
    return isGzipMagic(buf.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
}
