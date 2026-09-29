interface GenerationResult {
  status: 'ok' | 'stale';
  reason?: string;
}

export async function readGenerationResponse(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<GenerationResult> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(body?.error?.message ?? 'Something went wrong. Please try again.');
    return body as GenerationResult;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('The generation response did not include a stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  let result: GenerationResult | null = null;

  const consume = (frame: string) => {
    const event = frame.match(/^event: (.+)$/m)?.[1];
    const data = frame.match(/^data: (.+)$/m)?.[1];
    if (!event || !data) return;
    const payload = JSON.parse(data);
    if (event === 'delta' && typeof payload.delta === 'string') onDelta(payload.delta);
    if (event === 'complete') result = payload as GenerationResult;
    if (event === 'error')
      throw new Error(payload.error?.message ?? 'Generation failed. Please try again.');
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (!result) throw new Error('Generation ended before the draft was saved. Please try again.');
  return result;
}
