const FIREBASE_AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1'

export function getFirebaseAuthConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  }
}

export function isFirebaseAuthConfigured() {
  const { apiKey, projectId } = getFirebaseAuthConfig()
  return Boolean(apiKey && projectId)
}

export async function signInWithFirebaseEmail(email, password) {
  const { apiKey } = getFirebaseAuthConfig()
  if (!apiKey) {
    throw new Error('Firebase Auth is not configured')
  }

  const response = await fetch(`${FIREBASE_AUTH_BASE}/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    const code = data?.error?.message || 'FIREBASE_AUTH_ERROR'
    throw new Error(code)
  }

  return data
}

export function firebaseAuthErrorMessage(code) {
  const messages = {
    EMAIL_NOT_FOUND: 'Compte Firebase introuvable',
    INVALID_PASSWORD: 'Mot de passe Firebase incorrect',
    USER_DISABLED: 'Compte Firebase desactive',
    INVALID_LOGIN_CREDENTIALS: 'Identifiants Firebase invalides',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives. Reessayez plus tard',
  }
  return messages[code] || 'Connexion Firebase impossible'
}
