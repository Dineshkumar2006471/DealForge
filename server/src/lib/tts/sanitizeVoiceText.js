/**
 * DealForge — Voice Text Sanitizer
 *
 * Cleans LLM-generated text for natural text-to-speech output.
 * Strips markdown, bullets, code blocks, JSON, citation syntax,
 * and other artifacts that cause robotic/unnatural TTS pronunciation.
 *
 * RULES:
 *  - Never insert spaces between letters of words
 *  - Never transform currency, percentages, or dates
 *  - Never strip normal punctuation
 *  - Never over-normalize ordinary English
 *  - Always return clean spoken-language text
 */

/**
 * Sanitize text for voice/TTS output.
 * @param {string} text - Raw LLM output text
 * @returns {string} Clean spoken-language text
 */
function sanitizeVoiceText(text) {
  if (!text || typeof text !== 'string') return '';

  let s = text;

  // 1. Remove code blocks (``` ... ```) and their content
  s = s.replace(/```[\s\S]*?```/g, '');

  // 2. Remove inline code (`...`)
  s = s.replace(/`([^`]+)`/g, '$1');

  // 3. Remove markdown bold/italic markers
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1');
  s = s.replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1');

  // 4. Remove markdown headers
  s = s.replace(/^#{1,6}\s+/gm, '');

  // 5. Remove markdown links [text](url) -> text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 6. Remove markdown images
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // 7. Remove bullet markers at start of lines
  s = s.replace(/^\s*[-*\u2022+]\s+/gm, '');
  s = s.replace(/^\s*\d+[.)]\s+/gm, '');

  // 8. Remove HTML tags
  s = s.replace(/<[^>]+>/g, '');

  // 9. Remove citation/reference syntax [1], [2], etc.
  s = s.replace(/\[\d+\]/g, '');

  // 10. Remove JSON-like content
  s = s.replace(/\{[^{}]*"[^{}]*"[^{}]*:[^{}]*\}/g, '');

  // 11. Remove system/tool syntax markers
  s = s.replace(/\[SYSTEM\]/gi, '');
  s = s.replace(/\[TOOL\]/gi, '');
  s = s.replace(/\[DEBUG\]/gi, '');
  s = s.replace(/\[ERROR\]/gi, '');

  // 12. Remove excessive special characters that shouldn't be spoken
  s = s.replace(/[|~^`#=<>{}[\]\\]/g, ' ');

  // 13. Normalize whitespace
  s = s.replace(/\n+/g, ' ');
  s = s.replace(/\t+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ');

  // 14. Trim
  s = s.trim();

  // 15. Final safety check
  if (!s || /^[\s.,!?;:'"()-]+$/.test(s)) return '';

  return s;
}

module.exports = { sanitizeVoiceText };
