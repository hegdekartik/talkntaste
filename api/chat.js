import { getRecipes } from './_lib/supabase.js';
import { chatWithLibrary } from './_lib/chat.js';

/**
 * POST /api/chat
 * Converse with the user's saved recipe library in natural language.
 *
 * Request body:
 *   { "messages": [{ "role": "user", "content": "..." }, ...] }
 *
 * The recipe library is loaded server-side and grounded into the model prompt.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let messages = req.body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request must include a non-empty "messages" array.' });
  }

  // Keep only well-formed user/assistant messages, bound content length.
  const history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4000),
    }))
    .slice(-12);

  if (!history.length) {
    return res.status(400).json({ error: 'No valid messages provided.' });
  }

  const lastMessage = history[history.length - 1];
  if (lastMessage.role !== 'user') {
    return res.status(400).json({ error: 'Last message must be from the user.' });
  }

  try {
    const recipes = await getRecipes();
    const { reply, provider } = await chatWithLibrary({ messages: history, recipes });

    console.log(`[API] /chat replied via ${provider} (${recipes.length} recipes in context)`);
    res.status(200).json({ reply, provider });
  } catch (error) {
    console.error('[API] /chat error:', error.message);
    res.status(500).json({ error: error.message });
  }
}