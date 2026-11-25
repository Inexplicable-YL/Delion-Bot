import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

const title = z.string().trim().min(1).max(200);

export const noteContract = defineContract('note', {
  exportDocument: {
    input: z.discriminatedUnion('format', [
      z.object({ format: z.literal('pdf'), title, html: z.string().max(200_000_000) }),
      z.object({
        format: z.literal('docx'),
        title,
        bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0),
      }),
    ]),
    output: z.string().nullable(),
  },
});
