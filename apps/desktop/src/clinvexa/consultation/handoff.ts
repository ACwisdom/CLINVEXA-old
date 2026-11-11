export interface ConsultationSessionTarget {
  sessionId: string
  storedSessionId?: string
}

interface ConsultationNewSessionDependencies {
  createSession: (preview: string) => Promise<null | string>
  getStoredSessionId: () => null | string
  prepareFreshDraft: () => void
  submit: (prompt: string, target: ConsultationSessionTarget) => Promise<boolean | void>
}

/**
 * Create a durable conversation before handing off a consultation task.
 *
 * Preparing the fresh draft without navigating first is intentional: navigating
 * to `/new` and immediately submitting races the session anti-cross-talk guard,
 * which closes the newly-created runtime as apparent route drift. Waiting for
 * `session.create` gives the sidebar a real stored id and lets the first prompt
 * persist into exactly that conversation.
 */
export async function handoffConsultationToPersistedNewSession(
  prompt: string,
  dependencies: ConsultationNewSessionDependencies
): Promise<boolean> {
  dependencies.prepareFreshDraft()
  const sessionId = await dependencies.createSession(prompt)

  if (!sessionId) {
    return false
  }

  const storedSessionId = dependencies.getStoredSessionId()

  const submitted = await dependencies.submit(prompt, {
    sessionId,
    ...(storedSessionId ? { storedSessionId } : {})
  })

  return submitted !== false
}
