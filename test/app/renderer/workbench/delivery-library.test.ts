import { describe, expect, it } from 'vitest';
import {
  deliveryEntriesWithChildren,
  deliveryLibrary,
  visibleLeafSessions,
} from '../../../../src/app/renderer/workbench/delivery-library';

const alpha = '11111111-1111-4111-8111-111111111111';
const beta = '22222222-2222-4222-8222-222222222222';
const hidden = '33333333-3333-4333-8333-333333333333';

const titles = { [alpha]: '周报', [beta]: '周报', [hidden]: '备忘' };

function library(
  groups: { id: string; active: string | null }[],
  options?: { maximized?: string | null; focus?: string | null; names?: Record<string, string> },
) {
  return deliveryLibrary({
    directory: '/data/Delion Bot',
    groups,
    maximizedGroupId: options?.maximized ?? null,
    focusedGroupId: options?.focus ?? groups[0]?.id ?? null,
    titles: options?.names ?? titles,
    loaded: [],
  });
}

describe('资料区只跟随可见会话', () => {
  it('标签栏有多个会话但只显示一个面板时，直接铺开当前会话的交付内容', () => {
    const shown = library([{ id: 'primary', active: `chat:${alpha}` }]);
    expect(
      visibleLeafSessions('/data/Delion Bot', [{ id: 'primary', active: `chat:${alpha}` }], null),
    ).toEqual([alpha]);
    expect(shown.mode).toBe('flat');
    expect(shown.rootId).toBe(`/data/Delion Bot/chat-delivery/${alpha}`);
    expect(shown.entries.filter((entry) => entry.id !== shown.rootId)).toEqual([]);
    const withHiddenTab = library([
      {
        id: 'primary',
        active: `chat:${alpha}`,
      },
    ]);
    expect(withHiddenTab.rootId).not.toContain(beta);
  });

  it('同一面板里未激活的标签不进入资料', () => {
    const shown = library([{ id: 'primary', active: `note:readme` }]);
    expect(shown.mode).toBe('empty');
    const activeHidden = visibleLeafSessions(
      '/data/Delion Bot',
      [{ id: 'primary', active: `chat:${alpha}`, tabsNote: `chat:${hidden}` } as never],
      null,
    );
    expect(activeHidden).toEqual([alpha]);
    expect(activeHidden).not.toContain(hidden);
  });

  it('拆成两个可见会话时按会话名分组，重名仍用不同路径', () => {
    const shown = library(
      [
        { id: 'left', active: `chat:${alpha}` },
        { id: 'right', active: `chat:${beta}` },
      ],
      { focus: 'right' },
    );
    expect(shown.mode).toBe('grouped');
    expect(shown.entries.map((entry) => entry.name)).toEqual(['周报', '周报']);
    expect(shown.entries.map((entry) => entry.path)).toEqual([
      `/data/Delion Bot/chat-delivery/${alpha}`,
      `/data/Delion Bot/chat-delivery/${beta}`,
    ]);
    expect(shown.selectedId).toBe(shown.entries[1]!.id);
  });

  it('最大化或合并回单面板后不再分组', () => {
    const groups = [
      { id: 'left', active: `chat:${alpha}` },
      { id: 'right', active: `chat:${beta}` },
    ];
    expect(library(groups, { maximized: 'left' }).mode).toBe('flat');
    expect(library(groups, { maximized: 'left' }).rootId).toContain(alpha);
    expect(library([{ id: 'primary', active: `chat:${alpha}` }]).mode).toBe('flat');
  });

  it('同一会话在两个面板重复出现时只算一个', () => {
    const shown = library([
      { id: 'left', active: `chat:${alpha}` },
      { id: 'right', active: `chat:${alpha}` },
    ]);
    expect(shown.mode).toBe('flat');
    expect(shown.rootId).toContain(alpha);
  });

  it('会话重命名只改分组显示名，不改交付路径', () => {
    const before = library(
      [
        { id: 'left', active: `chat:${alpha}` },
        { id: 'right', active: `chat:${beta}` },
      ],
      { names: titles },
    );
    const after = library(
      [
        { id: 'left', active: `chat:${alpha}` },
        { id: 'right', active: `chat:${beta}` },
      ],
      { names: { ...titles, [alpha]: '三月周报' } },
    );
    expect(after.entries[0]).toMatchObject({ name: '三月周报', path: before.entries[0]!.path });
    expect(after.entries[0]!.name).not.toContain(alpha);
  });

  it('已加载的文件挂在交付根下，不带出 workspace', () => {
    const shown = library([
      { id: 'left', active: `chat:${alpha}` },
      { id: 'right', active: `chat:${beta}` },
    ]);
    const child = {
      id: `${shown.entries[0]!.id}/报告.md`,
      parentId: shown.entries[0]!.id,
      name: '报告.md',
      kind: 'file' as const,
      sourceId: null,
      path: `${shown.entries[0]!.id}/报告.md`,
      updatedAt: '',
    };
    const stray = {
      id: '/data/Delion Bot/workspace/旧笔记.md',
      parentId: null,
      name: '旧笔记.md',
      kind: 'file' as const,
      sourceId: null,
      updatedAt: '',
    };
    expect(
      deliveryEntriesWithChildren(shown.entries, [stray, child]).map((entry) => entry.name),
    ).toEqual(['周报', '周报', '报告.md']);
  });

  it('单个可见的文件标签打开交付文件时，直接进入该目录并定位到文件', () => {
    const file = `/data/Delion Bot/chat-delivery/${alpha}/资料/报告.md`;
    const shown = library([{ id: 'primary', active: `note:${file}` }]);
    expect(shown.mode).toBe('flat');
    expect(shown.rootId).toBe(`/data/Delion Bot/chat-delivery/${alpha}`);
    expect(shown.selectedId).toBe(file);
    expect(shown.expandedIds).toEqual([
      `/data/Delion Bot/chat-delivery/${alpha}`,
      `/data/Delion Bot/chat-delivery/${alpha}/资料`,
    ]);
    expect(shown.rootId).not.toContain('chat:');
  });

  it('拆分里一个对话和一个交付文件同时可见时按标题分组并定位到文件', () => {
    const file = `/data/Delion Bot/chat-delivery/${beta}/报告.md`;
    const shown = library(
      [
        { id: 'left', active: `chat:${alpha}` },
        { id: 'right', active: `preview:${file}` },
      ],
      { focus: 'right' },
    );
    expect(shown.mode).toBe('grouped');
    expect(shown.entries.map((entry) => entry.name)).toEqual(['周报', '周报']);
    expect(shown.entries.map((entry) => entry.path)).toEqual([
      `/data/Delion Bot/chat-delivery/${alpha}`,
      `/data/Delion Bot/chat-delivery/${beta}`,
    ]);
    expect(
      shown.entries.every((entry) => !entry.name.includes(alpha) && !entry.name.includes(beta)),
    ).toBe(true);
    expect(shown.selectedId).toBe(file);
    const renamed = library(
      [
        { id: 'left', active: `chat:${alpha}` },
        { id: 'right', active: `preview:${file}` },
      ],
      { focus: 'right', names: { ...titles, [beta]: '三月周报' } },
    );
    expect(renamed.entries[1]).toMatchObject({ name: '三月周报', path: shown.entries[1]!.path });
  });

  it('最大化正在看交付文件的面板时，只进入该文件所属会话', () => {
    const file = `/data/Delion Bot/chat-delivery/${beta}/报告.md`;
    const shown = library(
      [
        { id: 'left', active: `chat:${alpha}` },
        { id: 'right', active: `note:${file}` },
      ],
      { maximized: 'right', focus: 'right' },
    );
    expect(shown.mode).toBe('flat');
    expect(shown.rootId).toBe(`/data/Delion Bot/chat-delivery/${beta}`);
    expect(shown.selectedId).toBe(file);
    expect(shown.entries.some((entry) => entry.path?.includes(alpha))).toBe(false);
  });

  it('打开 workspace 里的文件不会进入交付目录', () => {
    const shown = library([{ id: 'primary', active: 'note:/data/Delion Bot/workspace/旧笔记.md' }]);
    expect(shown.mode).toBe('empty');
  });
});
