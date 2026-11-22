import React from "react";
import { RegionLabel, regions } from "./regions";
import { DemoTable, DemoDetails } from "./DemoPages";
import styles from "./styles.module.css";
export default function ConsoleCanvas({ mode, view, selected, onSelect }) {
  const plugin = mode === "page";
  const details = !plugin && view === "detail";
  const label = (id) => (
    <RegionLabel
      region={regions.find((region) => region.id === id)}
      selected={selected}
      onSelect={onSelect}
    />
  );
  const regionClass = (id) => (selected === id ? styles.highlight : "");
  return (
    <div
      className={styles.console}
      role="group"
      aria-label="Console mixed-nav 界面区域演示"
    >
      <DemoTopbar label={label} regionClass={regionClass} />
      <div className={styles.workspace}>
        <DemoSidebar plugin={plugin} label={label} regionClass={regionClass} />
        <DemoContent
          plugin={plugin}
          details={details}
          label={label}
          regionClass={regionClass}
        />
      </div>
    </div>
  );
}

function DemoTopbar({ plugin, details, label, regionClass }) {
  return (
    <div className={`${styles.topbar} ${regionClass("topbar")}`}>
      {label("topbar")}
      <div className={styles.brand}>
        <span aria-hidden="true">◈</span> ModelSphere
      </div>
      <div className={styles.topTools}>
        <span>API 密钥</span>
        <span>中 / EN</span>
        <span>偏好</span>
        <span className={styles.avatar}>N</span>
        <span>用户</span>
      </div>
    </div>
  );
}

function DemoSidebar({ plugin, details, label, regionClass }) {
  return (
    <div className={`${styles.sidebar} ${regionClass("sidebar")}`}>
      {label("sidebar")}
      <small className={styles.navHeading}>内建模块</small>
      <div className={styles.navItem}>⌂　概览</div>
      <div className={`${styles.navItem} ${!plugin ? styles.navActive : ""}`}>
        ▦　模型服务
      </div>
      <div className={styles.navItem}>◇　模型目录</div>
      <div className={styles.navItem}>⊞　用户与权限</div>
      <div className={styles.pluginNav}>
        <small className={styles.navHeading}>北极星 · 插件菜单</small>
        <div className={`${styles.navItem} ${plugin ? styles.navActive : ""}`}>
          ▤　实验列表 <span>menus[0]</span>
        </div>
        <div className={styles.navItem}>
          ⚑　价格配置 <span>menus[1]</span>
        </div>
      </div>
      <div className={styles.navFoot}>
        宿主统一渲染导航
        <br />
        group / order / authKey
      </div>
    </div>
  );
}

function DemoBanner({ plugin, details, label, regionClass }) {
  return (
    <div className={`${styles.banner} ${regionClass("banner")}`}>
      {label("banner")}
      <div className={styles.breadcrumb}>
        {plugin
          ? "北极星 / 实验管理"
          : `模型服务${details ? " / qwen-production" : ""}`}
      </div>
      <div className={styles.pageTitle}>
        {plugin ? "实验列表" : details ? "qwen-production" : "模型服务"}
        {details && (
          <span className={styles.extension}>
            <span className={styles.anchorName}>resource.header</span>
            北极星 · 关联 1 个实验
          </span>
        )}
      </div>
      <p>
        {plugin
          ? "管理 A/B 实验、基线与候选服务，观察流量分配和 SLO"
          : details
            ? "资源身份、基础信息与核心操作由宿主管理"
            : "统一管理模型部署与服务状态"}
      </p>
    </div>
  );
}

function DemoToolbar({ plugin, details, label, regionClass }) {
  return (
    <div className={`${styles.toolbar} ${regionClass("toolbar")}`}>
      {label("toolbar")}
      <div className={styles.toolbarItems}>
        <span className={styles.search}>
          {details ? "当前服务 · qwen-production" : "⌕ 搜索名称"}
        </span>
        <span className={styles.filter}>所有状态 ▾</span>
        <span className={styles.create}>
          {plugin ? "＋ 创建实验" : details ? "刷新状态" : "＋ 创建服务"}
        </span>
      </div>
    </div>
  );
}

function DemoPageBody({ plugin, details, label, regionClass }) {
  return (
    <div className={styles.pageBody}>
      <DemoToolbar
        plugin={plugin}
        details={details}
        label={label}
        regionClass={regionClass}
      />
      <div className={`${styles.mainBody} ${regionClass("body")}`}>
        {label("body")}
        {details ? <DemoDetails /> : <DemoTable plugin={plugin} />}
      </div>
      <div className={styles.ownership}>
        {plugin
          ? "插件提供页面组件；宿主提供 React / Router / Query / UI 等共享能力。"
          : details
            ? "仅绿色徽章为插件贡献。resource.header 接收宿主提供的当前资源上下文。"
            : "仅绿色行内内容为插件贡献。collection.row 按每行资源渲染；宿主继续拥有主查询与分页。"}
      </div>
    </div>
  );
}

function DemoContent({ plugin, details, label, regionClass }) {
  return (
    <div
      className={`${styles.content} ${plugin ? styles.pluginPage : ""} ${regionClass("content")}`}
    >
      <div className={styles.contentHeading}>
        {label("content")}
        <span className={plugin ? styles.pluginTag : styles.hostTag}>
          {plugin ? "插件拥有完整业务页" : "宿主拥有资源页"}
        </span>
      </div>
      <DemoBanner
        plugin={plugin}
        details={details}
        label={label}
        regionClass={regionClass}
      />
      <DemoPageBody
        plugin={plugin}
        details={details}
        label={label}
        regionClass={regionClass}
      />
    </div>
  );
}
