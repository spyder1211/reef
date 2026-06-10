import type { ConnectionGroup } from '../../shared/types'
import type { StoreDeps } from './ProfileStore'

export class GroupStore {
  constructor(private readonly deps: StoreDeps) {}

  list(): ConnectionGroup[] {
    return [...this.deps.load().groups].sort((a, b) => a.order - b.order)
  }

  create(name: string): ConnectionGroup {
    const doc = this.deps.load()
    const maxOrder = doc.groups.reduce((m, x) => Math.max(m, x.order), -1)
    const group: ConnectionGroup = { id: this.deps.genId(), name: name.trim(), order: maxOrder + 1 }
    doc.groups.push(group)
    this.deps.persist(doc)
    return group
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const doc = this.deps.load()
    const idx = doc.groups.findIndex((x) => x.id === id)
    if (idx < 0) return
    doc.groups[idx] = { ...doc.groups[idx], name: trimmed }
    this.deps.persist(doc)
  }

  delete(id: string): void {
    const doc = this.deps.load()
    doc.groups = doc.groups.filter((x) => x.id !== id)
    doc.profiles = doc.profiles.map((p) => (p.groupId === id ? { ...p, groupId: undefined } : p))
    this.deps.persist(doc)
  }

  reorder(orderedIds: string[]): void {
    const doc = this.deps.load()
    const byId = new Map(doc.groups.map((x) => [x.id, x]))
    let order = 0
    for (const id of orderedIds) {
      const grp = byId.get(id)
      if (grp) {
        grp.order = order++
        byId.delete(id)
      }
    }
    // orderedIds に無い既存グループは末尾に温存する
    for (const grp of byId.values()) grp.order = order++
    this.deps.persist(doc)
  }
}
