import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, QueryObserver, environmentManager } from "@tanstack/react-query";
import { EMPTY, planRequest, type Form } from "@swiss/components/DeploySettings";
import { deployApi, type PlanRequest } from "@swiss/lib/api";
import { helmValuesQueryKey, IMAGE_SLOTS_DEBOUNCE_MS, imageSlotsQueryOptions, previewForm, useImageSlots } from "./useImageSlots";

const helm = { defaults: "image:\n  repository: chart/engine\n  tag: \"1\"\n", overrides: "{}\n" };
const requestFor = (form: Form) => planRequest(form, { model: "m" });

let restoreDocument: (() => void) | undefined;

afterEach(() => {
  vi.useRealTimers();
  restoreDocument?.();
  restoreDocument = undefined;
  vi.restoreAllMocks();
  environmentManager.setIsServer(() => typeof window === "undefined");
});

function watch(enabled: boolean, form: Form = { ...EMPTY, serviceId: "m", images: { image: "mirror/x:1" }, edits: "note: typed\n" }, prepare?: (form: Form) => Promise<PlanRequest>) {
  environmentManager.setIsServer(() => false);
  const fetch = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const options = imageSlotsQueryOptions(form, requestFor, enabled, prepare);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  return { fetch, client, options, observer, unsubscribe };
}

describe("compose dry-run query", () => {
  it("does not fetch while nothing has opened it", async () => {
    const { fetch, unsubscribe } = watch(false);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("uses one key for the Images section and the Override YAML editor", async () => {
    const form = { ...EMPTY, serviceId: "m", replicaCount: "2", images: { image: "mirror/x:1" }, edits: "replicaCount: 9\n" };
    const images = imageSlotsQueryOptions(form, requestFor, true);
    const yaml = imageSlotsQueryOptions({ ...form, images: { image: "other/x:2" }, edits: "note: 1\n" }, requestFor, true);
    expect(images.queryKey).toEqual(yaml.queryKey);
    expect(images.queryKey).toEqual(helmValuesQueryKey(requestFor(previewForm(form))));
    expect(helmValuesQueryKey(requestFor(previewForm({ ...form, namespace: "other" })))).not.toEqual(images.queryKey);

    environmentManager.setIsServer(() => false);
    const fetch = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const a = new QueryObserver(client, images);
    const b = new QueryObserver(client, yaml);
    const stopA = a.subscribe(() => {});
    const stopB = b.subscribe(() => {});
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const posted = fetch.mock.calls[0][0];
    expect(posted.editsYAML).toBeUndefined();
    expect(posted.overrides?.image).toBeUndefined();
    stopA();
    stopB();
  });

  it("posts the prepared request when recovery recomposes it", async () => {
    const form = { ...EMPTY, serviceId: "m" };
    const prepared = { ...requestFor(previewForm(form)), release: "prepared" };
    const { fetch, unsubscribe } = watch(true, form, async () => prepared);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(prepared);
    unsubscribe();
  });

  it("composes once, 400ms after rapid request changes", async () => {
    const view = mountSlots(true);
    try {
      await view.render();
      expect(view.fetch).toHaveBeenCalledTimes(1);
      expect(view.fetch.mock.calls[0][0].namespace).toBe("ns-a");

      await act(async () => {
        view.api.setNamespace("ns-b");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        view.api.setNamespace("ns-c");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        view.api.setNamespace("ns-d");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(IMAGE_SLOTS_DEBOUNCE_MS - 1);
      });
      expect(view.fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(view.fetch).toHaveBeenCalledTimes(2);
      expect(view.fetch.mock.calls.map((call) => call[0].namespace)).toEqual(["ns-a", "ns-d"]);
    } finally {
      await view.unmount();
    }
  });

  it("fetches the current request as soon as the section opens", async () => {
    const view = mountSlots(false);
    try {
      await view.render();
      await act(async () => {
        view.api.setNamespace("ns-b");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(view.fetch).not.toHaveBeenCalled();
      await act(async () => {
        view.api.setEnabled(true);
      });
      expect(view.fetch).toHaveBeenCalledTimes(1);
      expect(view.fetch.mock.calls[0][0].namespace).toBe("ns-b");
    } finally {
      await view.unmount();
    }
  });
});

function mountSlots(enabled: boolean) {
  restoreDocument = installDocument();
  environmentManager.setIsServer(() => false);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const fetch = vi.spyOn(deployApi, "helmValues").mockResolvedValue(helm);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const api: { setNamespace: (namespace: string) => void; setEnabled: (on: boolean) => void } = {
    setNamespace: () => {},
    setEnabled: () => {},
  };
  function Probe() {
    const [namespace, setNamespace] = useState("ns-a");
    const [on, setOn] = useState(enabled);
    api.setNamespace = setNamespace;
    api.setEnabled = setOn;
    // The request appears with the section, the way a closed section passes no request.
    useImageSlots({ ...EMPTY, serviceId: "m", namespace }, (form) => (on ? requestFor(form) : undefined), on);
    return null;
  }
  return {
    fetch,
    api,
    render: () => act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
    }),
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

// react-dom's client renderer needs a document. The suite otherwise runs in node.
function installDocument(): () => void {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLIFrameElement: globalThis.HTMLIFrameElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    getComputedStyle: globalThis.getComputedStyle,
    getSelection: globalThis.getSelection,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
  };
  class HTMLElement {}
  class HTMLIFrameElement extends HTMLElement {}
  class Element {}
  class Node {}
  const make = (name = "DIV") => {
    const n: {
      nodeType: number;
      nodeName: string;
      nodeValue: string | null;
      textContent: string;
      style: Record<string, string>;
      childNodes: ReturnType<typeof make>[];
      parentNode: ReturnType<typeof make> | null;
      ownerDocument: Document | null;
      namespaceURI: string;
      tagName: string;
      attributes: Record<string, string>;
      addEventListener: () => void;
      removeEventListener: () => void;
      setAttribute: (key: string, value: string) => void;
      getAttribute: (key: string) => string | null;
      removeAttribute: (key: string) => void;
      hasAttribute: (key: string) => boolean;
      appendChild: <T>(child: T) => T;
      removeChild: <T>(child: T) => T;
      insertBefore: <T>(child: T, ref: unknown) => T;
      contains: (child: unknown) => boolean;
      compareDocumentPosition: () => number;
      focus: () => void;
      blur: () => void;
      remove: () => void;
    } = {
      nodeType: name === "#text" ? 3 : name === "#comment" ? 8 : 1,
      nodeName: name,
      nodeValue: null,
      textContent: "",
      style: {},
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      namespaceURI: "http://www.w3.org/1999/xhtml",
      tagName: name,
      attributes: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: (key, value) => {
        n.attributes[key] = String(value);
      },
      getAttribute: (key) => n.attributes[key] ?? null,
      removeAttribute: (key) => {
        delete n.attributes[key];
      },
      hasAttribute: (key) => key in n.attributes,
      appendChild: (child) => {
        const c = child as typeof n;
        c.parentNode?.removeChild(c);
        c.parentNode = n;
        n.childNodes.push(c);
        return child;
      },
      removeChild: (child) => {
        const c = child as typeof n;
        n.childNodes = n.childNodes.filter((item) => item !== c);
        c.parentNode = null;
        return child;
      },
      insertBefore: (child, ref) => {
        const c = child as typeof n;
        c.parentNode?.removeChild(c);
        c.parentNode = n;
        const at = n.childNodes.indexOf(ref as typeof n);
        if (at < 0) n.childNodes.push(c);
        else n.childNodes.splice(at, 0, c);
        return child;
      },
      contains: (child) => child === n || n.childNodes.some((item) => item === child || item.contains(child)),
      compareDocumentPosition: () => 0,
      focus: () => {},
      blur: () => {},
      remove: () => {
        n.parentNode?.removeChild(n);
      },
    };
    Object.defineProperty(n, "firstChild", { get: () => n.childNodes[0] ?? null });
    Object.defineProperty(n, "lastChild", { get: () => n.childNodes[n.childNodes.length - 1] ?? null });
    Object.defineProperty(n, "nextSibling", {
      get: () => {
        const siblings = n.parentNode?.childNodes;
        if (!siblings) return null;
        return siblings[siblings.indexOf(n) + 1] ?? null;
      },
    });
    return n;
  };
  const docEl = make("HTML");
  const body = make("BODY");
  const doc = {
    nodeType: 9,
    nodeName: "#document",
    documentElement: docEl,
    body,
    head: make("HEAD"),
    activeElement: body,
    defaultView: globalThis,
    visibilityState: "visible",
    hidden: false,
    hasFocus: () => true,
    createElement: (tag: string) => {
      const node = make(tag);
      node.ownerDocument = doc as unknown as Document;
      return node;
    },
    createElementNS: (_ns: string, tag: string) => doc.createElement(tag),
    createTextNode: (text: string) => {
      const node = make("#text");
      node.nodeValue = String(text);
      node.textContent = String(text);
      node.ownerDocument = doc as unknown as Document;
      return node;
    },
    createComment: (text: string) => {
      const node = make("#comment");
      node.nodeValue = String(text);
      return node;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    createEvent: () => ({ initEvent: () => {} }),
    elementFromPoint: () => null,
  };
  docEl.ownerDocument = doc as unknown as Document;
  body.ownerDocument = doc as unknown as Document;
  docEl.appendChild(body);
  Object.assign(globalThis, {
    HTMLElement,
    HTMLIFrameElement,
    Element,
    Node,
    document: doc,
    window: globalThis,
    getComputedStyle: () => new Proxy({}, { get: () => () => "" }),
    getSelection: () => null,
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return () => {
    const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    g.document = previous.document;
    g.window = previous.window;
    g.HTMLElement = previous.HTMLElement;
    g.HTMLIFrameElement = previous.HTMLIFrameElement;
    g.Element = previous.Element;
    g.Node = previous.Node;
    g.getComputedStyle = previous.getComputedStyle;
    g.getSelection = previous.getSelection;
    g.requestAnimationFrame = previous.requestAnimationFrame;
    g.cancelAnimationFrame = previous.cancelAnimationFrame;
    g.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
  };
}
