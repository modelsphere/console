/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  developerGuide: [
    'guide/index',
    { type: 'category', label: 'Console 架构', items: ['guide/architecture', 'guide/local-development'] },
    { type: 'category', label: '插件开发', items: ['guide/frontend-plugin', 'guide/menu-contract', 'guide/lifecycle', 'guide/canary'] },
    { type: 'category', label: '跨平台愿景', items: ['guide/portability'] },
  ],
};
