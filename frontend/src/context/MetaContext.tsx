import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { Meta } from '../lib/types'

const MetaContext = createContext<Meta | null>(null)

export function MetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null)

  useEffect(() => {
    api.get<Meta>('/meta').then((res) => setMeta(res.data)).catch(() => setMeta(null))
  }, [])

  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMeta(): Meta | null {
  return useContext(MetaContext)
}
