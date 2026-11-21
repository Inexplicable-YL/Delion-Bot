import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export const appCategories = [
  'Email & Calendar',
  'Docs & Storage',
  'Development',
  'Communication',
  'Projects & Tasks',
  'Design',
  'Social Media',
] as const;
export const featuredApps = {
  gmail: { category: 'Email & Calendar', description: '搜索收件箱、总结并起草邮件。' },
  outlook: { category: 'Email & Calendar', description: '收发邮件，管理日历与联系人。' },
  googlecalendar: { category: 'Email & Calendar', description: '查看日程安排并计划会议。' },
  googlemeet: { category: 'Email & Calendar', description: '创建会议并读取会议记录。' },
  zoom: { category: 'Email & Calendar', description: '安排会议，查看录制与参会信息。' },
  googledrive: { category: 'Docs & Storage', description: '在云端文件中查找资料与答案。' },
  googledocs: { category: 'Docs & Storage', description: '读取、撰写和修改文档。' },
  googlesheets: { category: 'Docs & Storage', description: '读取表格数据并更新单元格。' },
  notion: { category: 'Docs & Storage', description: '搜索页面、文档和数据库。' },
  airtable: { category: 'Docs & Storage', description: '查询和更新多维表格记录。' },
  dropbox: { category: 'Docs & Storage', description: '查找、上传和整理文件。' },
  one_drive: { category: 'Docs & Storage', description: '访问 OneDrive 中的文件。' },
  github: { category: 'Development', description: '查找代码、问题和拉取请求。' },
  gitlab: { category: 'Development', description: '管理仓库、合并请求与流水线。' },
  linear: { category: 'Development', description: '跟踪问题、项目与迭代。' },
  jira: { category: 'Development', description: '查询和更新工单与看板。' },
  sentry: { category: 'Development', description: '查看错误报告与性能问题。' },
  vercel: { category: 'Development', description: '查看部署状态与项目配置。' },
  slack: { category: 'Communication', description: '搜索频道消息并发送通知。' },
  microsoft_teams: { category: 'Communication', description: '读取聊天与频道，发送消息。' },
  discord: { category: 'Communication', description: '读取服务器频道并发送消息。' },
  lark: { category: 'Communication', description: '飞书国际版的消息、文档与日历。' },
  trello: { category: 'Projects & Tasks', description: '管理看板、列表与卡片。' },
  asana: { category: 'Projects & Tasks', description: '创建任务并跟踪项目进度。' },
  clickup: { category: 'Projects & Tasks', description: '管理任务、文档与目标。' },
  todoist: { category: 'Projects & Tasks', description: '添加待办并整理清单。' },
  figma: { category: 'Design', description: '读取设计文件、评论与组件。' },
  canva: { category: 'Design', description: '浏览和导出设计作品。' },
  miro: { category: 'Design', description: '读取和编辑白板内容。' },
  youtube: { category: 'Social Media', description: '搜索视频，管理频道与播放列表。' },
  twitter: { category: 'Social Media', description: '搜索推文并发布内容。' },
  reddit: { category: 'Social Media', description: '浏览社区帖子与评论。' },
} satisfies Record<string, { category: (typeof appCategories)[number]; description: string }>;
export const recommendedApps: (keyof typeof featuredApps)[] = [
  'gmail',
  'googlecalendar',
  'googledrive',
  'notion',
  'github',
  'slack',
  'outlook',
  'googledocs',
  'googlesheets',
  'linear',
  'figma',
  'zoom',
];
export const toolkit = z.enum(
  Object.keys(featuredApps) as [keyof typeof featuredApps, ...(keyof typeof featuredApps)[]],
);
export const app = z.object({ slug: toolkit, name: z.string(), logo: z.string() });
export const account = z.object({
  id: z.string(),
  alias: z.string().nullish(),
  toolkit: z.object({ slug: z.string() }),
  status: z.string(),
});
export const connectorsContract = defineContract('connectors', {
  configured: { input: z.undefined(), output: z.boolean() },
  setup: { input: z.string().trim().min(1).max(4096), output: z.void() },
  catalog: { input: z.undefined(), output: z.array(app) },
  accounts: { input: z.undefined(), output: z.array(account) },
  connect: { input: toolkit, output: z.url({ protocol: /^https$/ }) },
  disconnect: { input: z.string().min(1), output: z.void() },
});
declare module '../../app/module' {
  interface NavTargets {
    connectors: Record<never, never>;
  }
}
