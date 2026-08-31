import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearActiveConversation,
  loadActiveConversation,
  saveActiveConversation,
} from '../lib/conversation-state.js'

function createStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

test('une conversation reste ouvrable après actualisation', () => {
  const storage = createStorage()
  const questionId = 'question-123'

  // Envoi de la question : l’application mémorise le chat actif.
  saveActiveConversation(storage, questionId)

  // Actualisation : une nouvelle instance relit l’identifiant sauvegardé.
  const activeAfterRefresh = loadActiveConversation(storage)
  assert.equal(activeAfterRefresh, questionId)

  // Clic sur une conversation de l’historique : le même chat est rouvert.
  saveActiveConversation(storage, activeAfterRefresh)
  assert.equal(loadActiveConversation(storage), questionId)

  // « Nouvelle question » quitte l’ancien chat sans supprimer les données Supabase.
  clearActiveConversation(storage)
  assert.equal(loadActiveConversation(storage), '')
})
