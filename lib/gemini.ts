import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';

if (!apiKey) {
  const msg = '[CrewChief] GEMINI_API_KEY is not set. Set it in your .env file (see .env.example). AI features will not work.';
  if (process.env.NODE_ENV === 'development') {
    throw new Error(msg);
  } else {
    console.error(msg);
  }
}

export const genAI = new GoogleGenAI({
  apiKey
});

/*
  Generation settings, by how much freedom the job should have.

  These pair with the model tiers in `@crewchief/core/ai/models`: the model
  decides how much capability is brought to bear, these decide how much rope it
  gets. Both were previously flat — every call ran at temperature 0.3 or 0.7
  with an 8192-token ceiling, including a yes/no classification.

  `proConfig` used to exist here, was byte-for-byte identical to `flashConfig`,
  and was never imported by anything. It is gone; `proStructuredConfig` below
  is the real version of what it was reaching for.
*/

/** Prose a person reads: the consultant, an email draft. */
export const flashConfig = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 8192,
};

/** Structured extraction and estimation — JSON in, JSON out. */
export const flashStructuredConfig = {
  temperature: 0.3,
  topK: 20,
  topP: 0.9,
  maxOutputTokens: 8192,
};

/**
 * Dossier generation, and nothing else.
 *
 * The one call whose output is persisted and then read by every later answer,
 * so it is the one place worth paying for room. 8192 was truncating long
 * dossiers on vehicles with a lot of history — the failure is silent, because
 * a truncated dossier is still a dossier.
 */
export const proStructuredConfig = {
  temperature: 0.3,
  topK: 20,
  topP: 0.9,
  maxOutputTokens: 32768,
};

/**
 * Classification and lookup: a word, a short list, a small JSON verdict.
 *
 * Temperature 0 because these questions have right answers and creativity is
 * a defect. The output ceiling is the point — `validateConsultantDocument`
 * returns three short fields and was budgeted 8192 tokens, the same as a full
 * vehicle dossier.
 */
export const classificationConfig = {
  temperature: 0,
  topK: 1,
  topP: 0.1,
  maxOutputTokens: 512,
};
