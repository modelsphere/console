import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = process.env.CONSOLE_URL;
assert.ok(base, "Set CONSOLE_URL to an auth-disabled preview with a real engine catalog");
const session = "route-catalog-live-check";
function browser(...args) {
  const result = JSON.parse(execFileSync("agent-browser", ["--session", session, "--json", ...args], { encoding: "utf8", timeout: 40_000 }));
  assert.equal(result.success, true, result.error);
  return result.data;
}
const evaluate = (script) => browser("eval", script).result;

const response = await fetch(`${base}/api/llm/route-options`);
assert.equal(response.status, 200, "A real engine catalog must be configured");
const catalog = await response.json();
const options = new Map([...catalog.directives, ...catalog.advanced].map((d) => [d.key, d]));

try {
  browser("open", base);
  browser("set", "viewport", process.env.VIEWPORT_WIDTH ?? "1280", process.env.VIEWPORT_HEIGHT ?? "720");
  evaluate('localStorage.setItem("rise-locale", "en-US")');
  browser("open", `${base}/inferences/catalog/glm5.1?catalog=default`);
  browser("wait", "--text", "Deploy");
  const defaults = evaluate(`(async () => {
    const frame = () => new Promise(requestAnimationFrame);
    [...document.querySelectorAll("button")].filter((x) => x.textContent.trim() === "Deploy").at(-1).click();
    for (let i = 0; i < 300 && !document.querySelector("#deploy-sec-routing-section"); i++) await frame();
    const section = document.querySelector("#deploy-sec-routing-section");
    if (!section) throw new Error("Deploy routing section did not render");
    const sheet = section.closest('[data-slot="sheet-content"]');
    const sheetRect = sheet.getBoundingClientRect();
    if (sheetRect.left < 0 || sheetRect.right > innerWidth) throw new Error("Deploy sheet exceeds viewport width");
    section.querySelector("button").click();
    await frame();
    const tpsLabel = [...document.querySelectorAll("label")].find((x) => x.textContent.includes("TPS fallback"));
    const tps = document.getElementById(tpsLabel.htmlFor);
    const floor = document.querySelector('input[aria-label="Adaptive floor fraction"]');
    const trigger = section.querySelector('button[aria-haspopup="menu"]');
    trigger.scrollIntoView({ block: "center" });
    for (let i = 0; i < 12; i++) await frame();
    trigger.click();
    for (let i = 0; i < 12; i++) await frame();
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.includes("rt_limit_factor"));
    const menu = item.closest('[role="menu"]');
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.top < 0 || menuRect.bottom > innerHeight) throw new Error("Advanced menu exceeds available viewport height");
    const initial = item.getBoundingClientRect();
    menu.scrollTop += initial.top - menuRect.top - (menu.clientHeight - initial.height) / 2;
    for (let i = 0; i < 12; i++) await frame();
    const rect = item.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (document.elementFromPoint(x, y)?.closest('[role="menuitem"]') !== item) throw new Error("Advanced item is not pointer reachable");
    return { tps: tps.placeholder, floor: floor.placeholder, tpsValue: tps.value, floorValue: floor.value, x, y };
  })()`);
  assert.equal(defaults.tps, options.get("tps_limit_tps").fallback);
  assert.equal(defaults.floor, options.get("adaptive_cc_min_frac").fallback);
  assert.equal(defaults.tpsValue, "");
  assert.equal(defaults.floorValue, "");
  browser("mouse", "move", String(Math.round(defaults.x)), String(Math.round(defaults.y)));
  browser("mouse", "down");
  browser("mouse", "up");
  const selected = evaluate(`(() => {
    const input = document.querySelector('input[id$="-rt_limit_factor"]');
    if (!input) throw new Error("Native pointer selection did not add the option");
    return { value: input.value, placeholder: input.placeholder };
  })()`);
  assert.equal(selected.value, "");
  assert.equal(selected.placeholder, options.get("rt_limit_factor").fallback);
  console.log(JSON.stringify({ realCatalog: true, route: catalog.route, hostDefaults: { tps: defaults.tps, floor: defaults.floor }, viewportAndNativePointer: true, unsetAdvancedPreserved: true }));
} finally {
  browser("close");
}
