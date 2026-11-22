// IndexedDB 封装:车型 / 玻璃 / 工位 / 批次 / 设置
const DB_NAME = 'windshield_optics'
const DB_VERSION = 1

export const STORES = ['vehicles', 'glasses', 'stations', 'batches', 'settings'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

export const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const tx = async <T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const getAll = async <T>(store: StoreName): Promise<T[]> => tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)

export const get = async <T>(store: StoreName, id: string): Promise<T | undefined> =>
  tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T>)

export const put = async <T>(store: StoreName, value: T): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.put(value))
}

export const del = async (store: StoreName, id: string): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.delete(id))
}

export const clear = async (store: StoreName): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.clear())
}

export const exportAll = async (): Promise<Record<string, unknown[]>> => {
  const out: Record<string, unknown[]> = {}
  for (const s of STORES) out[s] = await getAll(s)
  return out
}

export const importAll = async (data: Record<string, unknown[]>): Promise<void> => {
  for (const s of STORES) {
    if (!Array.isArray(data[s])) continue
    await clear(s)
    for (const item of data[s]) await put(s, item)
  }
}
