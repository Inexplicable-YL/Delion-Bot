import { z } from 'zod';
import { resourceRefSchema, type ResourceRef } from '../contract';
import { workspaceFilePath } from './api';
import { readWorkspaceResource, type ResourceContent } from './resources';
import type { CommandDomain } from '../../../core/capabilities/commands';
import { resourceResolver, type ResourceResolver } from '../../../core/capabilities/resources';
import { freshness, offset, tool, toolError } from '../../../core/capabilities/domain-tools';

function refineReadError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('不存在') || message.includes('尚未同步'))
    return toolError('NOT_FOUND', message);
  return error;
}

export function documentHint(ref: ResourceRef, title: string, format: string) {
  return {
    ref,
    title,
    format,
    readable: false,
    totalCharacters: null,
    nextOffset: null,
    hint: 'Use the document-reading skill. Run delion prepare_document to obtain temporary files and tool paths, then extract text or inspect page images. If the document components are missing, install them in Settings › Skills.',
  };
}

export function readDocument(
  ref: ResourceRef,
  content: ResourceContent,
  offset: number,
  limit: number,
) {
  const cached = freshness('cached');
  if (content.format === 'image' && content.bytes && content.mime) {
    return {
      ref,
      title: content.title,
      format: 'image',
      revision: content.revision ?? null,
      freshness: cached,
      pageImages: [{ page: 1 }],
      images: [
        {
          page: 1,
          dataUrl: `data:${content.mime};base64,${Buffer.from(content.bytes).toString('base64')}`,
        },
      ],
      note: 'The image is attached as an image message.',
    };
  }
  if (content.text === undefined) return documentHint(ref, content.title, content.format);
  const text = content.text;
  return {
    ref,
    title: content.title,
    format: content.format,
    revision: content.revision ?? null,
    url: content.url,
    freshness: cached,
    text: text.slice(offset, offset + limit),
    readable: true,
    totalCharacters: text.length,
    nextOffset: offset + limit < text.length ? offset + limit : null,
  };
}

const readResourceTool = tool(
  'Read project text and notes with character-based pagination. Images are returned as images. Binary documents and attachments return instructions for the document-reading skill.',
  z
    .object({
      ref: resourceRefSchema,
      offset,
      limit: z.number().int().min(1).max(30000).default(12000),
    })
    .strict(),
  async ({ ref, offset, limit }) => {
    try {
      return await resourceResolver(ref.type).read(ref, offset, limit);
    } catch (error) {
      throw refineReadError(error);
    }
  },
);

export const workspaceResourceResolver: ResourceResolver<
  Extract<ResourceRef, { type: 'workspace' }>
> = {
  read: async (ref, offset, limit) =>
    readDocument(ref, await readWorkspaceResource(ref.id), offset, limit),
  path: (ref) => workspaceFilePath(ref.id),
};

export const resourceDomain = {
  name: 'resource',
  description: 'Read project files and notes.',
  commands: { read_resource: readResourceTool },
} satisfies CommandDomain;
