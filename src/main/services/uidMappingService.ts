import { join, extname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { getDb } from './dataService'

const UID_START = 10000

export interface UidMappingData {
  nextUid: number
  mapping: Record<string, number> // openid → uid
}

export interface PlayerWithUid {
  /** 数据库中存储的 UID */
  uid: string
  /** openid（来自 uid_mapping） */
  openid: string | null
  /** 最近一次聊天中的昵称 */
  nickname?: string
  recordCount: number
  sources: string[]
}

/**
 * 加载项目的 uid_mapping.json
 */
export function getUidMapping(projectPath: string): UidMappingData {
  const filePath = join(projectPath, '.qqbat', 'uid_mapping.json')
  if (!existsSync(filePath)) {
    return { nextUid: UID_START, mapping: {} }
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return { nextUid: UID_START, mapping: {} }
  }
}

/**
 * 保存 uid_mapping.json
 */
export function saveUidMapping(projectPath: string, data: UidMappingData): void {
  const dir = join(projectPath, '.qqbat')
  const filePath = join(dir, 'uid_mapping.json')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * 获取所有玩家及其UID映射信息
 * 返回合并了 uid_mapping 和数据库玩家列表的结果
 */
export function getPlayersWithUid(projectPath: string): PlayerWithUid[] {
  const mapping = getUidMapping(projectPath)
  // 构建 uid → openid 反向映射
  const uidToOpenid = new Map<number, string>()
  for (const [openid, uid] of Object.entries(mapping.mapping)) {
    uidToOpenid.set(uid, openid)
  }

  // 从数据库获取玩家列表
  const dataDir = join(projectPath, 'data', 'players')
  if (!existsSync(dataDir)) return []

  const playerMap = new Map<string, { count: number; sources: Set<string>; openid: string | null; nickname?: string }>()

  for (const file of readdirSync(dataDir)) {
    const ext = extname(file).toLowerCase()
    if (ext !== '.db' && ext !== '.sqlite') continue
    const fullPath = join(dataDir, file)
    const db = getDb(fullPath)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    for (const t of tables) {
      const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string; type: string }[]
      const qqCol = columns.find(c => c.name === 'qq' || c.name === 'user_id' || c.name === 'qq_number')
      const nameCol = columns.find(c => c.name === 'nickname' || c.name === 'name' || c.name === 'player_name')
      if (!qqCol) continue

      const qqRows = db.prepare(`SELECT DISTINCT "${qqCol.name}" as qq_val FROM "${t.name}" WHERE "${qqCol.name}" IS NOT NULL AND "${qqCol.name}" != ''`).all() as { qq_val: string }[]

      for (const r of qqRows) {
        const uidNum = parseInt(r.qq_val, 10)
        const openid = isNaN(uidNum) ? null : uidToOpenid.get(uidNum) || null

        if (!playerMap.has(r.qq_val)) {
          const entry: { count: number; sources: Set<string>; openid: string | null; nickname?: string } = {
            count: 0,
            sources: new Set(),
            openid
          }
          if (t.name === 'players' && nameCol) {
            const nameRow = db.prepare(`SELECT "${nameCol.name}" as nm FROM "${t.name}" WHERE "${qqCol.name}" = ? LIMIT 1`).get(r.qq_val) as { nm: string } | undefined
            if (nameRow) entry.nickname = nameRow.nm
          }
          playerMap.set(r.qq_val, entry)
        }

        playerMap.get(r.qq_val)!.sources.add(file)
        const cnt = (db.prepare(`SELECT COUNT(*) as c FROM "${t.name}" WHERE "${qqCol.name}" = ?`).get(r.qq_val) as { c: number }).c
        playerMap.get(r.qq_val)!.count += cnt
      }
    }
  }

  return Array.from(playerMap.entries())
    .map(([uid, info]) => ({
      uid,
      openid: info.openid,
      nickname: info.nickname,
      recordCount: info.count,
      sources: Array.from(info.sources)
    }))
    .sort((a, b) => b.recordCount - a.recordCount)
}

/**
 * 更新玩家的 UID（更新 uid_mapping.json + 所有数据库记录）
 * @returns 旧 UID（如果存在）
 */
export function updatePlayerUid(
  projectPath: string,
  openid: string,
  newUid: number
): { oldUid: number | null; success: boolean } {
  if (newUid < 1) throw new Error('UID 必须大于 0')

  const mapping = getUidMapping(projectPath)

  // 检查新 UID 是否已被占用（排除同一 openid）
  const existingOpenid = Object.entries(mapping.mapping).find(
    ([o, u]) => u === newUid && o !== openid
  )
  if (existingOpenid) {
    throw new Error(`UID ${newUid} 已被其他玩家占用`)
  }

  const oldUid = mapping.mapping[openid] ?? null

  // 更新 uid_mapping
  mapping.mapping[openid] = newUid
  if (newUid >= mapping.nextUid) {
    mapping.nextUid = newUid + 1
  }
  saveUidMapping(projectPath, mapping)

  // 如果存在旧 UID，更新数据库中的记录
  if (oldUid !== null && oldUid !== newUid) {
    const oldUidStr = String(oldUid)
    const newUidStr = String(newUid)
    const dataDir = join(projectPath, 'data', 'players')
    if (existsSync(dataDir)) {
      for (const file of readdirSync(dataDir)) {
        const ext = extname(file).toLowerCase()
        if (ext !== '.db' && ext !== '.sqlite') continue
        const fullPath = join(dataDir, file)
        try {
          const db = getDb(fullPath)
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
          for (const t of tables) {
            const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string; type: string }[]
            const qqCol = columns.find(c => c.name === 'qq' || c.name === 'user_id' || c.name === 'qq_number')
            if (!qqCol) continue
            // 将 oldUid 更新为 newUid
            db.prepare(`UPDATE "${t.name}" SET "${qqCol.name}" = ? WHERE "${qqCol.name}" = ?`).run(newUidStr, oldUidStr)
          }
        } catch {
          // 跳过无法打开的数据库文件
        }
      }
    }
  }

  return { oldUid, success: true }
}


