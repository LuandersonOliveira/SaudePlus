import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { toast } from 'sonner'

// O estado do Sonner é global ao módulo: sem isto, toasts de um teste vazam para o seguinte.
afterEach(() => {
  toast.dismiss()
})

// jsdom não implementa matchMedia (o Sonner usa para detectar o tema).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// Radix (Select, Dialog) usa APIs que o jsdom não tem.
const proto = Element.prototype as unknown as Record<string, unknown>
proto.hasPointerCapture ??= () => false
proto.setPointerCapture ??= () => {}
proto.releasePointerCapture ??= () => {}
proto.scrollIntoView ??= () => {}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
