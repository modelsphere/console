const { themes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
module.exports = {
  title: 'Console 开发指南',
  tagline: '宿主架构、插件开发与跨平台合同',
  url: process.env.DOCS_URL || 'http://localhost',
  baseUrl: process.env.DOCS_BASE_URL || '/',
  onBrokenLinks: 'throw',
  i18n: { defaultLocale: 'zh-Hans', locales: ['zh-Hans'] },
  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: 'throw' },
  },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    ['classic', {
      docs: {
        path: '../docs',
        include: ['guide/**/*.md', 'guide/**/*.mdx'],
        routeBasePath: '/',
        sidebarPath: './sidebars.js',
      },
      blog: false,
      theme: { customCss: './src/css/custom.css' },
    }],
  ],
  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: false },
    navbar: {
      title: 'Console 开发指南',
      items: [
        { type: 'docSidebar', sidebarId: 'developerGuide', label: '开发指南', position: 'left' },
        { to: '/overview/frontend/frontend-plugin', label: '前端插件', position: 'left' },
        { href: 'https://github.com/modelsphere/console', label: 'GitHub', position: 'right' },
      ],
    },
    docs: { sidebar: { hideable: true, autoCollapseCategories: false } },
    footer: { style: 'dark', copyright: 'ModelSphere Console · 开发指南' },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
      additionalLanguages: ['bash', 'yaml', 'typescript', 'go', 'json'],
    },
  },
};
