const API_BASE = '/api/v1'

export async function apiRequest<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem('ledgerguard-auth-token')

  if (!token) {
    throw new Error('Your session has expired. Please sign in again.')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'Unable to load data.')
  }

  return payload.data as T
}
