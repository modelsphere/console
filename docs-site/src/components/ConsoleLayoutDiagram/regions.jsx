import React from "react";
import styles from "./styles.module.css";
export const regions = [
  {
    id: "topbar",
    number: "01",
    name: "TopBar 顶栏",
    text: "宿主提供品牌、快捷入口、语言、偏好与用户会话。当前远程插件适配没有开放顶栏贡献。",
  },
  {
    id: "sidebar",
    number: "02",
    name: "Sidebar 侧边栏",
    text: "宿主聚合内建模块与插件 menus[]，统一处理分组、排序、权限和当前项。一个插件可以贡献多个菜单，不止一个入口。",
  },
  {
    id: "content",
    number: "03",
    name: "Content 内容区",
    text: "宿主保留路由容器与共享上下文。插件整页接入时，页面组件拥有这一块业务内容；局部扩展时，宿主资源页保留骨架。",
  },
  {
    id: "banner",
    number: "04",
    name: "PageBanner 页头",
    text: "内容区内的页面标题区，不是独立 Shell 区域。由当前页面组合标题与说明；详情扩展锚点位于资源头部，而不是每个列表页都常驻。",
  },
  {
    id: "toolbar",
    number: "05",
    name: "Toolbar 工具栏",
    text: "当前页面组合筛选、搜索、刷新和页面操作。资源页局部扩展不会接管宿主的查询、分页或核心操作生命周期。",
  },
  {
    id: "body",
    number: "06",
    name: "业务主体",
    text: "列表、详情、表单或图表都在内容区内。下方切换列表与详情，可看到 collection.row 与 resource.header 分别出现的位置。",
  },
];

export function RegionLabel({ region, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`${styles.regionLabel} ${selected === region.id ? styles.selectedLabel : ""}`}
      aria-pressed={selected === region.id}
      onClick={() => onSelect(region.id)}
    >
      <span>{region.number}</span>
      {region.name}
    </button>
  );
}
