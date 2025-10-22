import OpenAI from 'openai';

export async function summarizeAudioContext(prevSummary: string, newUtterance: string): Promise<string> {
  const system = `You maintain a concise rolling summary (<= 200 words) of ambient audio context.
Include only information relevant to assisting the user with on-going tasks.
Avoid duplicating content; integrate updates succinctly.`;
  const user = `Previous summary:\n${prevSummary || '(none)'}\n\nNew utterance:\n${newUtterance}\n\nUpdate the summary.`;
  const client = new OpenAI();
  const model = process.env['OPENAI_DEFAULT_MODEL'] || 'gpt-4o-mini';
  const resp = await client.chat.completions.create({
    model,
    messages: [
      {role: 'system', content: system},
      {role: 'user', content: user},
    ],
    temperature: 0.2,
  });
  return resp.choices?.[0]?.message?.content?.trim?.() || prevSummary || '';
}
