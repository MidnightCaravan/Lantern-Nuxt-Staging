type LanternFlashMessage = {
  message: string
  category: 'success' | 'error'
}

export function useLanternFlash() {
  const state = useState<LanternFlashMessage | null>(
    'lantern-one-time-flash',
    () => null,
  )

  function set(message: string, category: 'success' | 'error' = 'success') {
    state.value = { message, category }
  }

  function consume(): LanternFlashMessage | null {
    const message = state.value
    state.value = null
    return message
  }

  return { set, consume }
}
