import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import type {
  BlockContent,
  DefinitionContent,
  Image,
  List,
  PhrasingContent,
  Root,
  RootContent,
} from 'mdast';
import { loadImages, type ImageLoader, type LoadedImage } from './export-source';

const MONO_FONT = 'Consolas';
const CODE_FILL = 'F6F8FA';
const RULE_COLOR = 'D2D2D7';
const CONTENT_WIDTH_PX = 600;
const LIST_INDENT = 360;
const QUOTE_INDENT = 480;
const headingLevels = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;
const wordImageTypes = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp'],
] as const);

type RunStyle = { bold?: boolean; italics?: boolean; strike?: boolean };
type WordImage = {
  type: 'png' | 'jpg' | 'gif' | 'bmp';
  data: ArrayBuffer;
  width: number;
  height: number;
};
type Context = {
  images: Map<Image, WordImage | null>;
  quote: number;
  list?: { reference: 'bullet' | 'ordered'; level: number; instance: number };
  nextInstance: () => number;
};
type Block = Paragraph | Table;

async function wordImageOf(image: LoadedImage): Promise<WordImage | null> {
  const scale = Math.min(1, CONTENT_WIDTH_PX / image.width);
  const size = { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
  const type = wordImageTypes.get(image.blob.type as never);
  if (type) return { type, data: await image.blob.arrayBuffer(), ...size };
  const bitmap = await createImageBitmap(image.blob);
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return { type: 'png', data: await png.arrayBuffer(), ...size };
}

function inlines(
  nodes: PhrasingContent[],
  context: Context,
  style: RunStyle = {},
): ParagraphChild[] {
  return nodes.flatMap((node): ParagraphChild[] => {
    switch (node.type) {
      case 'text':
        return [new TextRun({ text: node.value.replace(/\n/g, ' '), ...style })];
      case 'strong':
        return inlines(node.children, context, { ...style, bold: true });
      case 'emphasis':
        return inlines(node.children, context, { ...style, italics: true });
      case 'delete':
        return inlines(node.children, context, { ...style, strike: true });
      case 'inlineCode':
        return [
          new TextRun({
            text: node.value,
            font: MONO_FONT,
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
            ...style,
          }),
        ];
      case 'inlineMath':
        return [new TextRun({ text: node.value, font: 'Cambria Math', ...style })];
      case 'break':
        return [new TextRun({ break: 1 })];
      case 'link': {
        const children = inlines(node.children, context, style);
        return /^(https?|mailto):/i.test(node.url)
          ? [new ExternalHyperlink({ link: node.url, children })]
          : children;
      }
      case 'linkReference':
        return inlines(node.children, context, style);
      case 'image': {
        const image = context.images.get(node);
        if (image)
          return [
            new ImageRun({
              type: image.type,
              data: image.data,
              transformation: { width: image.width, height: image.height },
              altText: {
                name: node.alt ?? '',
                description: node.alt ?? '',
                title: node.title ?? '',
              },
            }),
          ];
        const label = node.alt || node.url;
        return /^https?:/i.test(node.url)
          ? [
              new ExternalHyperlink({
                link: node.url,
                children: [new TextRun({ text: label, style: 'Hyperlink' })],
              }),
            ]
          : [new TextRun({ text: label, ...style })];
      }
      case 'imageReference':
        return [new TextRun({ text: node.alt ?? '', ...style })];
      case 'footnoteReference':
        return [new TextRun({ text: `[${node.label ?? node.identifier}]`, superScript: true })];
      default:
        return [];
    }
  });
}

function paragraph(context: Context, options: IParagraphOptions): Paragraph {
  const indent = context.quote * QUOTE_INDENT;
  return new Paragraph({
    ...options,
    ...(context.quote > 0 && {
      indent: { left: indent },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: RULE_COLOR, space: 8 } },
    }),
    ...(context.list && {
      numbering: {
        reference: context.list.reference,
        level: context.list.level,
        instance: context.list.instance,
      },
    }),
  });
}

function listBlocks(node: List, context: Context): Block[] {
  const reference = node.ordered ? 'ordered' : 'bullet';
  const level = context.list ? context.list.level + 1 : 0;
  const instance = context.nextInstance();
  return node.children.flatMap((item) =>
    item.children.flatMap((child, index) => {
      const marker = index === 0 && item.checked != null ? (item.checked ? '☑ ' : '☐ ') : '';
      if (index === 0 && child.type === 'paragraph')
        return [
          paragraph(
            { ...context, list: { reference, level, instance } },
            { children: [new TextRun(marker), ...inlines(child.children, context)] },
          ),
        ];
      if (child.type === 'list')
        return listBlocks(child, { ...context, list: { reference, level, instance } });
      return blocks([child], { ...context, list: undefined });
    }),
  );
}

function tableBlock(node: Extract<RootContent, { type: 'table' }>, context: Context): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: node.children.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: row.children.map(
            (cell, cellIndex) =>
              new TableCell({
                shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'F5F5F7' } : undefined,
                children: [
                  new Paragraph({
                    alignment:
                      node.align?.[cellIndex] === 'center'
                        ? AlignmentType.CENTER
                        : node.align?.[cellIndex] === 'right'
                          ? AlignmentType.RIGHT
                          : AlignmentType.LEFT,
                    children: inlines(cell.children, context, { bold: rowIndex === 0 }),
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

function blocks(
  nodes: (RootContent | BlockContent | DefinitionContent)[],
  context: Context,
): Block[] {
  return nodes.flatMap((node): Block[] => {
    switch (node.type) {
      case 'heading':
        return [
          paragraph(context, {
            heading: headingLevels[node.depth - 1],
            children: inlines(node.children, context),
          }),
        ];
      case 'paragraph':
        return [paragraph(context, { children: inlines(node.children, context) })];
      case 'blockquote':
        return blocks(node.children, { ...context, quote: context.quote + 1 });
      case 'list':
        return listBlocks(node, context);
      case 'code':
        return node.value.split(/\r?\n/).map((line) =>
          paragraph(context, {
            spacing: { before: 0, after: 0 },
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
            children: [new TextRun({ text: line, font: MONO_FONT })],
          }),
        );
      case 'math':
        return [
          paragraph(context, {
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: node.value, font: 'Cambria Math' })],
          }),
        ];
      case 'thematicBreak':
        return [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 1 } },
          }),
        ];
      case 'table':
        return [tableBlock(node, context)];
      case 'footnoteDefinition': {
        const [first, ...rest] = node.children;
        const label = new TextRun({
          text: `[${node.label ?? node.identifier}] `,
          superScript: true,
        });
        return first?.type === 'paragraph'
          ? [
              paragraph(context, { children: [label, ...inlines(first.children, context)] }),
              ...blocks(rest, context),
            ]
          : blocks(node.children, context);
      }
      default:
        return [];
    }
  });
}

const bulletLevels: ILevelsOptions[] = Array.from({ length: 9 }, (_, level) => ({
  level,
  format: LevelFormat.BULLET,
  text: ['•', '◦', '▪'][level % 3]!,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: LIST_INDENT } } },
}));

const orderedLevels: ILevelsOptions[] = Array.from({ length: 9 }, (_, level) => ({
  level,
  format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]!,
  text: `%${level + 1}.`,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: LIST_INDENT } } },
}));

export async function markdownToDocx(tree: Root, title: string, loadImage: ImageLoader) {
  const loaded = await loadImages(tree, loadImage);
  const images = new Map<Image, WordImage | null>();
  for (const [node, image] of loaded)
    images.set(node, image ? await wordImageOf(image).catch(() => null) : null);
  let instance = 0;
  const document = new Document({
    title,
    styles: {
      default: {
        document: {
          run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' } },
        },
      },
    },
    numbering: {
      config: [
        { reference: 'bullet', levels: bulletLevels },
        { reference: 'ordered', levels: orderedLevels },
      ],
    },
    sections: [
      {
        children: blocks(tree.children, {
          images,
          quote: 0,
          nextInstance: () => (instance += 1),
        }),
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
