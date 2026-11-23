import { z } from 'zod';
import type { CommandDomain } from '../../../../core/capabilities/commands';
import { DOCUMENT_SKILL } from '../runtime';
import { prepareDocumentResource, releaseDocumentResource } from '../../../workspace';
import { resourceRefSchema } from '../../../workspace/contract';
import skill from './skill/SKILL.md?raw';
import script from './skill/scripts/read.py?raw';
import { tool } from '../../../../core/capabilities/domain-tools';

export const documentDomain = {
  name: 'document',
  description: 'Prepare and clean up temporary files for the document-reading skill.',
  skill: {
    name: DOCUMENT_SKILL,
    files: [
      { path: 'SKILL.md', content: skill },
      { path: 'scripts/read.py', content: script },
    ],
  },
  commands: {
    prepare_document: tool(
      'Prepare temporary files and tool paths for the document-reading skill. Requires the installed document components. This command neither parses the document nor copies it into the project.',
      z.object({ ref: resourceRefSchema }).strict(),
      ({ ref }) => prepareDocumentResource(ref),
    ),
    release_document: tool(
      'Remove temporary input and output from prepare_document after you finish reading the text and images.',
      z.object({ jobId: z.string() }).strict(),
      async ({ jobId }) => {
        await releaseDocumentResource(jobId);
        return { released: true };
      },
    ),
  },
} satisfies CommandDomain;
