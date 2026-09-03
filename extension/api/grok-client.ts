/**
 * GrokClient - Step 6: Sends sanitized view to Cloud Guidance API (Grok / Groq), parses structured JSON.
 */

import { GrokGuidanceOutput } from '../policy/action-validator';

export const GROK_SYSTEM_PROMPT = `You are a browser guidance agent. The screen you receive has already been
sanitized locally; masked boxes, placeholders, and surrogate values represent
hidden sensitive information. Treat them as intentional privacy protections,
never ask to reveal originals, and reason only from the sanitized view.

For each screen, first summarize what the page appears to be, then state the
user's likely current step, then propose the next safest action. If
information is missing because of masking, say exactly what is missing and
continue with the best privacy-preserving guidance possible.

IMPORTANT FIELD VALIDATION:
Check if any filled or redacted values contradict their form field labels (e.g. an [EMAIL] entered into a 'Roll Number' or 'Phone' field). If there is a mismatch, add an item to risk_flags (e.g. 'mismatch: Roll Number field contains an email address') and highlight the warning in rationale so the user can fix it before submitting.

Return JSON only, no prose, no markdown fences:
{
  "screen_type": string,
  "goal_state": string,
  "visible_key_elements": string[],
  "hidden_sensitive_regions": string[],
  "next_action": "click" | "scroll" | "type_placeholder" | "navigate" | "wait" | "stop",
  "action_target": string,
  "confidence": number,
  "ask_user_confirmation": boolean,
  "risk_flags": string[],
  "rationale": string
}`;

export interface SanitizedPayload {
  sanitizedScreenshotUrl: string;
  urlDomain: string;
  pageTitleCategory: string;
  elementRoles: string[];
}

export async function requestGrokGuidance(
  payload: SanitizedPayload,
  apiKey?: string,
  mockMode: boolean = false
): Promise<GrokGuidanceOutput> {
  const activeKey = apiKey || (typeof process !== 'undefined' && process.env ? process.env.GROQ_API_KEY : '') || '';

  // If in Mock Mode
  if (mockMode && !apiKey) {
    return {
      screen_type: 'Registration Form',
      goal_state: 'Complete form submission',
      visible_key_elements: ['#name', '#email', '#card', 'button[type="submit"]'],
      hidden_sensitive_regions: ['[NAME: Alex Mercer]', '[EMAIL: user1@example.com]', '[CARD: **** **** **** 1234]'],
      next_action: 'click',
      action_target: 'button[type="submit"]',
      confidence: 0.96,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: 'All required fields are populated with valid privacy surrogate values. Safe to proceed by clicking submit.'
    };
  }

  // Determine endpoint based on API key configuration
  const isGroq = true;
  const endpoint = isGroq
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.x.ai/v1/chat/completions';
  const model = isGroq ? 'openai/gpt-oss-120b' : 'grok-vision-beta';

  const userContent: any[] = [
    {
      type: 'text',
      text: `Page Category: ${payload.pageTitleCategory}\nDomain: ${payload.urlDomain}\nElement Roles: ${payload.elementRoles.join(', ')}\nProvide the next safest browser action based on this sanitized view.`
    }
  ];

  // Include image for vision models
  if (!isGroq && payload.sanitizedScreenshotUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: payload.sanitizedScreenshotUrl }
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${activeKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: GROK_SYSTEM_PROMPT },
        { role: 'user', content: isGroq ? userContent[0].text : userContent }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    })
  });

  if (!response.ok) {
    throw new Error(`Cloud Guidance API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content || '{}';
  const cleanJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();

  return JSON.parse(cleanJson) as GrokGuidanceOutput;
}
