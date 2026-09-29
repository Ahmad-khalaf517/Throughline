import { describe, expect, it, vi } from 'vitest';
import { readGenerationResponse } from '@/components/review/read-generation-stream';

function splitResponse(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('readGenerationResponse', () => {
  it('reassembles split SSE frames and returns completion only after all deltas', async () => {
    const onDelta = vi.fn();
    const response = splitResponse([
      'event: started\ndata: {}\n\nevent: del',
      'ta\ndata: {"delta":"<script>"}\n\nevent: delta\ndata: {"delta":"ok"}\n\n',
      'event: complete\ndata: {"status":"ok"}\n\n',
    ]);
    await expect(readGenerationResponse(response, onDelta)).resolves.toEqual({ status: 'ok' });
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual(['<script>', 'ok']);
  });

  it('surfaces a streamed error and rejects an incomplete stream', async () => {
    await expect(
      readGenerationResponse(
        splitResponse(['event: error\ndata: {"error":{"message":"failed"}}\n\n']),
        vi.fn(),
      ),
    ).rejects.toThrow('failed');
    await expect(
      readGenerationResponse(splitResponse(['event: delta\ndata: {"delta":"x"}\n\n']), vi.fn()),
    ).rejects.toThrow('before the draft was saved');
  });
});
