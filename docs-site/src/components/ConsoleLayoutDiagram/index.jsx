import React, { useId, useState } from "react";
import ConsoleCanvas from "./ConsoleCanvas";
import { RegionLabel, regions } from "./regions";
import styles from "./styles.module.css";
export default function ConsoleLayoutDiagram() {
  const instanceId = useId();
  const [mode, setMode] = useState("page");
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState("content");
  const changeMode = (nextMode) => {
    setMode(nextMode);
    setView("list");
  };
  return (
    <figure className={styles.diagram} aria-label="交互式 Console 界面区域图">
      <DiagramControls
        mode={mode}
        view={view}
        onMode={changeMode}
        setView={setView}
      />
      <p className={styles.scrollHint}>
        窄屏可左右滑动界面示意，保留真实布局比例；下方编号可直接选择区域。
      </p>
      <div
        className={styles.canvasViewport}
        role="region"
        aria-label="可横向滚动的 Console 页面示意"
        tabIndex={0}
      >
        <ConsoleCanvas
          mode={mode}
          view={view}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <RegionExplanation
        instanceId={instanceId}
        selected={selected}
        setSelected={setSelected}
      />
    </figure>
  );
}

function RegionExplanation({ instanceId, selected, setSelected }) {
  const activeRegion = regions.find((region) => region.id === selected);
  return (
    <>
      <div
        className={styles.regionPicker}
        role="group"
        aria-label="选择界面区域"
        aria-describedby={`${instanceId}-explanation`}
      >
        {regions.map((region) => (
          <RegionLabel
            key={region.id}
            region={region}
            selected={selected}
            onSelect={setSelected}
          />
        ))}
      </div>
      <div className={styles.note}>
        PageBanner、Toolbar 与业务主体均属于 Content。Provider
        是运行时上下文，不是可见界面区域；本图不包含 Global Dock 或多 Scope
        选择器。
      </div>
      <figcaption
        id={`${instanceId}-explanation`}
        className={styles.explanation}
        aria-live="polite"
      >
        <strong>
          {activeRegion.number} / {activeRegion.name}
        </strong>
        <span>{activeRegion.text}</span>
      </figcaption>
    </>
  );
}

function DiagramControls({ mode, view, onMode, setView }) {
  return (
    <>
      <div className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>CONSOLE / MIXED-NAV</span>
          <strong>同一套宿主，两种插件接入</strong>
        </div>
        <span className={styles.demoTag}>交互示意 · 非运行中 Console</span>
      </div>
      <ModeSwitch mode={mode} onMode={onMode} />
      <ViewSwitch mode={mode} view={view} setView={setView} />
      <div className={styles.legend}>
        <span>
          <i className={styles.hostDot} />
          宿主管理
        </span>
        <span>
          <i className={styles.pluginDot} />
          插件贡献
        </span>
        <span>点击编号，查看职责边界</span>
      </div>
    </>
  );
}

function ModeSwitch({ mode, onMode }) {
  return (
    <div className={styles.modeSwitch} role="group" aria-label="插件接入模式">
      <button
        type="button"
        aria-pressed={mode === "page"}
        onClick={() => {
          onMode("page");
        }}
      >
        A　插件整页 <small>菜单 → 路由 → 自有页面</small>
      </button>
      <button
        type="button"
        aria-pressed={mode === "extension"}
        onClick={() => {
          onMode("extension");
        }}
      >
        B　宿主资源页局部扩展 <small>稳定资源上下文 → 展示锚点</small>
      </button>
    </div>
  );
}

function ViewSwitch({ mode, view, setView }) {
  if (mode !== "extension") return null;
  return (
    <div
      className={styles.viewSwitch}
      role="group"
      aria-label="宿主资源页面类型"
    >
      <span>查看锚点位置：</span>
      <button
        type="button"
        aria-pressed={view === "list"}
        onClick={() => setView("list")}
      >
        列表 · collection.row
      </button>
      <button
        type="button"
        aria-pressed={view === "detail"}
        onClick={() => setView("detail")}
      >
        详情 · resource.header
      </button>
    </div>
  );
}
