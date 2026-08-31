const ACTIVE_CONVERSATION_KEY = 'humain-gpt-active-question'

function saveActiveConversation(storage, questionId) {
  if (questionId) storage.setItem(ACTIVE_CONVERSATION_KEY, questionId)
  else storage.removeItem(ACTIVE_CONVERSATION_KEY)
}

function loadActiveConversation(storage) {
  return storage.getItem(ACTIVE_CONVERSATION_KEY) || ''
}

function clearActiveConversation(storage) {
  storage.removeItem(ACTIVE_CONVERSATION_KEY)
}

module.exports = {
  saveActiveConversation,
  loadActiveConversation,
  clearActiveConversation,
}
