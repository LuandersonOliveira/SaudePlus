import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** O roteador não rola até `#âncora` sozinho: rola ao trocar de rota ou hash e volta ao topo sem hash. */
export function ScrollToHash() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    const el = document.getElementById(decodeURIComponent(hash.slice(1)))
    el?.scrollIntoView()
  }, [pathname, hash])

  return null
}
