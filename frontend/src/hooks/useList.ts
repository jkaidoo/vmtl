import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Paginated } from '../lib/types'

interface ListState<T> {
  items: T[]
  page: number
  lastPage: number
  total: number
  loading: boolean
  setPage: (p: number) => void
  reload: () => void
}

/**
 * Fetch a paginated list from the API. `params` is stringified for the
 * dependency check so callers can pass an inline object.
 */
export function useList<T>(url: string, params: Record<string, unknown> = {}): ListState<T> {
  const [items, setItems] = useState<T[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify(params)

  const load = useCallback(() => {
    setLoading(true)
    api
      .get<Paginated<T>>(url, { params: { ...params, page } })
      .then((res) => {
        setItems(res.data.data)
        if (res.data.meta) {
          setLastPage(res.data.meta.last_page)
          setTotal(res.data.meta.total)
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, page, key])

  useEffect(() => load(), [load])

  // Reset to page 1 whenever the filters change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [key])

  return { items, page, lastPage, total, loading, setPage, reload: load }
}
