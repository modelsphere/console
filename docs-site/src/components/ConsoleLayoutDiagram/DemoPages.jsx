import React from "react";
import styles from "./styles.module.css";
export function DemoTable({ plugin }) {
  const rows = plugin
    ? ["qwen-ab-canary", "deepseek-rollout", "routing-compare"]
    : ["qwen-production", "deepseek-evaluation", "embedding-service"];
  return (
    <div className={styles.tableScroll}>
      <table className={styles.demoTable}>
        <caption className={styles.srOnly}>
          {plugin ? "插件实验列表" : "宿主模型服务列表"}，均为演示数据
        </caption>
        <thead>
          <tr>
            <th>{plugin ? "实验名称" : "服务名称"}</th>
            <th>状态</th>
            <th>{plugin ? "基线服务" : "模型"}</th>
            <th>{plugin ? "候选服务" : "插件贡献"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((name, index) => (
            <DemoRow key={name} name={name} index={index} plugin={plugin} />
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        演示数据 · 共 3 项 <span>每页 10 项　 ‹　1　›</span>
      </div>
    </div>
  );
}

function DemoRow({ name, index, plugin }) {
  return (
    <tr>
      <td>
        <strong>{name}</strong>
      </td>
      <td>
        <span className={styles.status}>
          {index === 2 ? "已就绪" : "运行中"}
        </span>
      </td>
      <td>
        {plugin
          ? ["qwen-stable", "deepseek-v1", "router-stable"][index]
          : ["Qwen / 32B", "DeepSeek / V3", "BGE / M3"][index]}
      </td>
      <td>
        {plugin ? (
          ["qwen-canary", "deepseek-v2", "router-next"][index]
        ) : (
          <span className={styles.extension}>
            <span className={styles.anchorName}>collection.row</span>
            关联实验 {index + 1}
          </span>
        )}
      </td>
    </tr>
  );
}
export function DemoDetails() {
  return (
    <div className={styles.detailBody}>
      <div className={styles.detailTabs}>
        <strong>概览</strong>
        <span>运行记录</span>
        <span>配置</span>
      </div>
      <div className={styles.detailGrid}>
        <div>
          <small>模型</small>
          <strong>Qwen / 32B</strong>
        </div>
        <div>
          <small>服务状态</small>
          <strong className={styles.status}>运行中</strong>
        </div>
        <div>
          <small>资源身份</small>
          <strong>qwen-production</strong>
        </div>
        <div>
          <small>服务副本</small>
          <strong>2 / 2 可用</strong>
        </div>
      </div>
      <DemoMetrics />
    </div>
  );
}

function DemoMetrics() {
  return (
    <div className={styles.chart}>
      <span>宿主资源指标</span>
      <div aria-hidden="true">
        {[29, 42, 36, 58, 48, 68, 56, 72, 66, 80, 71, 86].map(
          (height, index) => (
            <i key={index} style={{ height: `${height}%` }} />
          ),
        )}
      </div>
      <small>示意图 · 非实时监控</small>
    </div>
  );
}
