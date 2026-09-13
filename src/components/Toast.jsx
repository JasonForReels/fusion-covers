import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const show = useCallback((message, isError = false) => {
    clearTimeout(timer.current)
    setToast({ message, isError })
    timer.current = setTimeout(() => setToast(null), isError ? 5000 : 2200)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className={`toast ${toast ? 'show' : ''} ${toast?.isError ? 'err' : ''}`}>
        {toast?.message}
      </div>
    </ToastContext.Provider>
  )
}
