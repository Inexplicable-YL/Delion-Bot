import authorAvatar from '../../../../assets/credits/changyo/avatar.jpg';
import icebeerAvatar from '../../../../assets/credits/icebeer/avatar.jpg';
import aizyeeeAvatar from '../../../../assets/credits/aizyeee/avatar.png';
import aaalpsssAvatar from '../../../../assets/credits/aaalpsss/avatar.png';
import huangtongAvatar from '../../../../assets/credits/huangtong601-ops/avatar.jpg';
import jinjiAvatar from '../../../../assets/credits/jinji-2005/avatar.jpg';
import cophqAvatar from '../../../../assets/credits/cophq/avatar.jpg';
import sbsjkmAvatar from '../../../../assets/credits/sbsjkm/avatar.jpg';
import slayerwaltAvatar from '../../../../assets/credits/slayerwalt/avatar.jpg';
import aletheiarAvatar from '../../../../assets/credits/aletheiar/avatar.png';
import yixuanwang4Avatar from '../../../../assets/credits/yixuanwang4/avatar.png';
import frameneoLogoBlack from '../../../../assets/sponsors/FRAMENEO_logo_black.png';
import frameneoLogoWhite from '../../../../assets/sponsors/FRAMENEO_logo_white.png';

export type SocialLinkKind = 'github' | 'blog' | 'zhihu' | 'website' | 'bilibili';

export interface SocialLink {
  kind: SocialLinkKind;
  url: string;
  label?: string;
}

export interface CreditPerson {
  name: string;
  avatar?: string;
  logo?: { light: string; dark: string };
  links?: SocialLink[];
}

export interface CreditSection {
  title: string;
  people: CreditPerson[];
}

export const creditSections: CreditSection[] = [
  {
    title: 'Original Author',
    people: [
      {
        name: 'ChangYo',
        avatar: authorAvatar,
        links: [
          { kind: 'github', url: 'https://github.com/Chang-Yo' },
          { kind: 'blog', url: 'https://changyo.pages.dev' },
        ],
      },
    ],
  },
  {
    title: 'Upstream Contributors',
    people: [
      {
        name: 'aizyeee',
        avatar: aizyeeeAvatar,
        links: [
          { kind: 'github', url: 'https://github.com/aizyeee' },
          { kind: 'website', url: 'https://aizyeee.com' },
        ],
      },
      {
        name: 'AAAlpsss',
        avatar: aaalpsssAvatar,
        links: [{ kind: 'github', url: 'https://github.com/AAAlpsss' }],
      },
      {
        name: 'huangtong601-ops',
        avatar: huangtongAvatar,
        links: [{ kind: 'bilibili', url: 'https://space.bilibili.com/355707853' }],
      },
      {
        name: 'jinji-2005',
        avatar: jinjiAvatar,
        links: [{ kind: 'github', url: 'https://github.com/jinji-2005' }],
      },
      {
        name: 'cophQ',
        avatar: cophqAvatar,
        links: [{ kind: 'github', url: 'https://github.com/cophQ' }],
      },
      {
        name: 'SBSJKM',
        avatar: sbsjkmAvatar,
        links: [{ kind: 'github', url: 'https://github.com/SBSJKM' }],
      },
      {
        name: 'slayerwalt',
        avatar: slayerwaltAvatar,
        links: [{ kind: 'github', url: 'https://github.com/slayerwalt' }],
      },
      {
        name: 'Aletheiar',
        avatar: aletheiarAvatar,
        links: [{ kind: 'github', url: 'https://github.com/Aletheiar' }],
      },
      {
        name: 'YixuanWang4',
        avatar: yixuanwang4Avatar,
      },
    ],
  },
  {
    title: 'Upstream Sponsors',
    people: [
      {
        name: 'FRAMENEO',
        logo: { light: frameneoLogoBlack, dark: frameneoLogoWhite },
        links: [{ kind: 'website', url: 'https://www.frameneo.com/' }],
      },
      {
        name: '冰啤史莱姆',
        avatar: icebeerAvatar,
        links: [{ kind: 'zhihu', url: 'https://www.zhihu.com/people/66-72-53-62-30' }],
      },
    ],
  },
];
