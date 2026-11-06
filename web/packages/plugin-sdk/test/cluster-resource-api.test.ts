import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RESOURCES_FACADE_PREFIX,
  RiseResourceError,
  RiseResourcePathError,
  buildResourcePath,
  clusterViewScopeOrThrow,
  resolveClusterViewScope,
  scopedApi,
} from '../src/cluster-resource-api'

const NS_PATH = RESOURCES_FACADE_PREFIX + 'namespaces/team-a/pods'
const CLUSTER_NS_PATH = '/clusters/member-1' + NS_PATH
const CORE_NS_PATH = '/api/v1/namespaces/team-a/pods'
const GROUPS_NS_PATH = '/apis/apps/v1/namespaces/team-a/deployments'
const OWN_OAPI_PATH = '/oapis/modelx.rise.io/v1alpha1/models'

// ── buildResourcePath：通用 API 路径（三类根都接受） ─────────────────────────

describe('buildResourcePath — 通用路径接受', () => {
  it('resources façade namespaced 路径消费轴原样返回', () => {
    expect(buildResourcePath(NS_PATH, { axis: 'consumption' })).toBe(NS_PATH)
  })

  it('原生 core API /api/v1 消费轴原样返回', () => {
    expect(buildResourcePath(CORE_NS_PATH, { axis: 'consumption' })).toBe(CORE_NS_PATH)
  })

  it('原生 group API /apis/apps/v1 消费轴原样返回', () => {
    expect(buildResourcePath(GROUPS_NS_PATH, { axis: 'consumption' })).toBe(GROUPS_NS_PATH)
  })

  it('插件自有 /oapis/{group}/{version} 消费轴原样返回', () => {
    expect(buildResourcePath(OWN_OAPI_PATH, { axis: 'consumption' })).toBe(OWN_OAPI_PATH)
  })

  it('任意 group/version 组合都被接受，不限于已知资源形态', () => {
    expect(buildResourcePath('/oapis/log.rise.io/v1/datasets/ds/logs', { axis: 'consumption' })).toBe(
      '/oapis/log.rise.io/v1/datasets/ds/logs',
    )
    expect(buildResourcePath('/oapis/tenant.theriseunion.io/v1alpha1/workspaces', { axis: 'consumption' })).toBe(
      '/oapis/tenant.theriseunion.io/v1alpha1/workspaces',
    )
    expect(buildResourcePath('/oapis/resources.rise.io/v2/namespaces/a/pods', { axis: 'consumption' })).toBe(
      '/oapis/resources.rise.io/v2/namespaces/a/pods',
    )
  })

  it('cluster-scoped 路径（无 namespace 段）消费轴放行——语义由调用方确认', () => {
    expect(buildResourcePath(RESOURCES_FACADE_PREFIX + 'nodes', { axis: 'consumption' })).toBe(
      RESOURCES_FACADE_PREFIX + 'nodes',
    )
    expect(buildResourcePath('/api/v1/nodes', { axis: 'consumption' })).toBe('/api/v1/nodes')
    expect(buildResourcePath(RESOURCES_FACADE_PREFIX + 'namespaces', { axis: 'consumption' })).toBe(
      RESOURCES_FACADE_PREFIX + 'namespaces',
    )
  })

  it('消费轴下 ns label 自动路由只对 façade 读有效——SDK 不代猜，行为差异见 README 表', () => {
    // 通用化后消费轴对三类路径都发裸路径；是否按 ns label 路由数据面
    // 是后端对 resources façade 的专属行为，原生 /api /apis 走 Karmada proxy，
    // 调用方需自行确认目标 API 语义。
    for (const path of [NS_PATH, CORE_NS_PATH, GROUPS_NS_PATH]) {
      expect(buildResourcePath(path, { axis: 'consumption' })).not.toContain('/clusters/')
    }
  })

  it('带 query 的路径原样保留 query', () => {
    const withQuery = NS_PATH + '?limit=100'
    expect(buildResourcePath(withQuery, { axis: 'consumption' })).toBe(withQuery)
  })
})

describe('buildResourcePath — 供给轴（cluster 前缀注入）', () => {
  it('façade 路径加 /clusters/{c} 前缀', () => {
    expect(buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'member-1' })).toBe(CLUSTER_NS_PATH)
  })

  it('原生 /api/v1 路径同样加前缀', () => {
    expect(buildResourcePath(CORE_NS_PATH, { axis: 'cluster', cluster: 'member-1' })).toBe(
      '/clusters/member-1' + CORE_NS_PATH,
    )
  })

  it('原生 /apis 路径同样加前缀', () => {
    expect(buildResourcePath(GROUPS_NS_PATH, { axis: 'cluster', cluster: 'member-1' })).toBe(
      '/clusters/member-1' + GROUPS_NS_PATH,
    )
  })

  it('插件自有 /oapis 路径同样加前缀——授权轴变化、目标 Service 不变', () => {
    expect(buildResourcePath(OWN_OAPI_PATH, { axis: 'cluster', cluster: 'member-1' })).toBe(
      '/clusters/member-1' + OWN_OAPI_PATH,
    )
  })

  it("host 集群同样加前缀——'host' 是真实本地平面，不是控制面回退值", () => {
    expect(buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'host' })).toBe('/clusters/host' + NS_PATH)
  })

  it('带点号的集群名（DNS1123 subdomain）接受并编码', () => {
    expect(buildResourcePath(CORE_NS_PATH, { axis: 'cluster', cluster: 'cluster.bj-1' })).toBe(
      '/clusters/cluster.bj-1' + CORE_NS_PATH,
    )
  })

  it("保留值 '_all' 抛可识别错误，不静默切回消费轴", () => {
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: '_all' })).toThrow(RiseResourcePathError)
  })

  it('空 cluster 抛错', () => {
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: '' })).toThrow(RiseResourcePathError)
  })

  it('注入尝试（斜杠 / 空格 / %2f / 问号 / 大写 / 控制字符）抛错', () => {
    for (const bad of ['a/b', 'a b', 'a%2fb', 'a?b', 'a#b', 'A-B-大写', 'a\u0000']) {
      expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: bad })).toThrow(RiseResourcePathError)
    }
  })

  it('超长 cluster 名（>253）拒绝', () => {
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'a'.repeat(254) })).toThrow(
      RiseResourcePathError,
    )
  })

  it('非法 namespace 名拒绝（含原生 /api /apis 路径与供给轴）', () => {
    expect(() =>
      buildResourcePath(RESOURCES_FACADE_PREFIX + 'namespaces/Bad_NS/pods', {
        axis: 'cluster',
        cluster: 'member-1',
      }),
    ).toThrow(RiseResourcePathError)
    expect(() => buildResourcePath('/api/v1/namespaces/Bad_NS/pods', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
    expect(() => buildResourcePath('/apis/apps/v1/namespaces/Bad_NS/x', { axis: 'cluster', cluster: 'member-1' })).toThrow(
      RiseResourcePathError,
    )
  })

  it('_all / _all_ 保留 namespace 段拒绝（三类路径一致）', () => {
    expect(() => buildResourcePath('/api/v1/namespaces/_all/pods', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
    expect(() => buildResourcePath('/apis/apps/v1/namespaces/_all_/x', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
  })
})

describe('buildResourcePath — path 形态边界', () => {
  it('拒绝绝对 http(s) URL——不把平台凭据带出域', () => {
    for (const url of [
      'https://evil.example.com' + NS_PATH,
      'http://127.0.0.1:8080/x',
      'https://same-origin.example' + CORE_NS_PATH,
    ]) {
      expect(() => buildResourcePath(url, { axis: 'consumption' })).toThrow(RiseResourcePathError)
      expect(() => buildResourcePath(url, { axis: 'cluster', cluster: 'member-1' })).toThrow(RiseResourcePathError)
    }
  })

  it('拒绝 URL fragment，防止追加 query 落在 hash 后被忽略', () => {
    expect(() => buildResourcePath(CORE_NS_PATH + '#fragment', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
  })

  it('拒绝相对协议 URL', () => {
    expect(() => buildResourcePath('//evil.example.com/x', { axis: 'consumption' })).toThrow(RiseResourcePathError)
  })

  it('拒绝非 API 根前缀的路径（静态资源 / 页面路由不是 API）', () => {
    const rejected = [
      '/plugins/foo/index.js',
      '/login',
      '/oapis', // 缺尾斜杠不算 API 根
      '/api', // 同上
      '/apis', // 同上
      '/oapisx/foo/v1',
      '/v1/namespaces/a/pods',
    ]
    for (const path of rejected) {
      expect(() => buildResourcePath(path, { axis: 'consumption' }), path).toThrow(RiseResourcePathError)
      expect(() => buildResourcePath(path, { axis: 'cluster', cluster: 'member-1' }), path).toThrow(
        RiseResourcePathError,
      )
    }
  })

  it('拒绝已带 /clusters/ 前缀的 path（重复前缀是调用 bug）', () => {
    expect(() => buildResourcePath(CLUSTER_NS_PATH, { axis: 'cluster', cluster: 'member-1' })).toThrow(
      RiseResourcePathError,
    )
    expect(() => buildResourcePath(CLUSTER_NS_PATH, { axis: 'consumption' })).toThrow(RiseResourcePathError)
  })

  it('拒绝不以 / 开头的相对路径', () => {
    expect(() => buildResourcePath('oapis/modelx.rise.io/v1alpha1/x', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
  })

  it('scopedApi 传输入口同样拒绝非 API 根路径（不只纯函数文档承诺）', async () => {
    await expect(scopedApi.get('/plugins/foo/index.js', { axis: 'consumption' })).rejects.toThrow(
      RiseResourcePathError,
    )
    await expect(scopedApi.get('/login', { axis: 'consumption' })).rejects.toThrow(RiseResourcePathError)
  })
})

// ── resolveClusterViewScope / clusterViewScopeOrThrow ───────────────────────

describe('resolveClusterViewScope', () => {
  it('现行 /cluster/{c} URL 解析出集群名', () => {
    expect(resolveClusterViewScope('/cluster/ecs-001/core.rise.io/v1/kube-infra/nodes')).toEqual({
      cluster: 'ecs-001',
    })
  })

  it('旧版 /(boss|metrics|express)/clusters/{c} URL 同样识别', () => {
    expect(resolveClusterViewScope('/boss/clusters/ecs-001/some/page')).toEqual({ cluster: 'ecs-001' })
    expect(resolveClusterViewScope('/metrics/clusters/ecs-001/x')).toEqual({ cluster: 'ecs-001' })
    expect(resolveClusterViewScope('/express/clusters/ecs-001/x')).toEqual({ cluster: 'ecs-001' })
  })

  it('workspace / project / platform 页面返回 null——不代猜 host', () => {
    expect(resolveClusterViewScope('/workspace/team-a/core.rise.io/v1/tenant/overview')).toBeNull()
    expect(
      resolveClusterViewScope('/workspace/team-a/project/dev/core.rise.io/v1/project-infra/pods'),
    ).toBeNull()
    expect(resolveClusterViewScope('/core.rise.io/v1/core/users')).toBeNull()
  })

  it('非法编码或非法 DNS1123 cluster 视图返回 null，不抛原始 URIError', () => {
    expect(resolveClusterViewScope('/cluster/%/x')).toBeNull()
    expect(resolveClusterViewScope('/cluster/%2F/x')).toBeNull()
    expect(resolveClusterViewScope('/cluster/a..b/x')).toBeNull()
  })

  it("'_all' 全部集群视图返回 null——聚合视图不是可下钻集群", () => {
    expect(resolveClusterViewScope('/cluster/_all/core.rise.io/v1/kube-infra/list')).toBeNull()
    expect(resolveClusterViewScope('/boss/clusters/_all/x')).toBeNull()
  })

  it('无 pathname 参数且无 window 时返回 null', () => {
    expect(resolveClusterViewScope('/no-cluster-here')).toBeNull()
  })
})

describe('clusterViewScopeOrThrow', () => {
  afterEach(() => {
    delete (globalThis as any).window
  })

  it('cluster 视图（window.location 指向 /cluster/host/…）返回供给轴 scope', () => {
    ;(globalThis as any).window = {
      location: { pathname: '/cluster/host/core.rise.io/v1/kube-infra/nodes' },
    }
    expect(clusterViewScopeOrThrow()).toEqual({ axis: 'cluster', cluster: 'host' })
  })

  it('project URL fail-closed：抛可识别错误而不是猜 host', () => {
    ;(globalThis as any).window = {
      location: { pathname: '/workspace/team-a/project/dev/core.rise.io/v1/project-infra/pods' },
    }
    expect(() => clusterViewScopeOrThrow()).toThrow(RiseResourcePathError)
    expect(() => clusterViewScopeOrThrow()).toThrow(/不在 cluster 视图/)
  })

  it('无 window 环境同样抛错', () => {
    expect(() => clusterViewScopeOrThrow()).toThrow(RiseResourcePathError)
  })
})

// ── 传输层 ───────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown, statusText = ''): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('scopedApi 传输层', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('消费轴 GET 发裸路径 + credentials include', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }))
    const res = await scopedApi.get(NS_PATH, { axis: 'consumption' })
    expect(res).toEqual({ data: { items: [] }, status: 200 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(NS_PATH)
    expect(init.credentials).toBe('include')
  })

  it('原生 /api/v1 消费轴 GET 发裸路径', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(CORE_NS_PATH, { axis: 'consumption' })
    expect(fetchMock.mock.calls[0][0]).toBe(CORE_NS_PATH)
  })

  it('插件自有 /oapis 消费轴 GET 发裸路径', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(OWN_OAPI_PATH, { axis: 'consumption' })
    expect(fetchMock.mock.calls[0][0]).toBe(OWN_OAPI_PATH)
  })

  it('供给轴 GET 发 /clusters/{c} 前缀（façade 与原生 API 一致）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(NS_PATH, { axis: 'cluster', cluster: 'member-1' })
    expect(fetchMock.mock.calls[0][0]).toBe(CLUSTER_NS_PATH)

    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get('/api/v1/nodes', { axis: 'cluster', cluster: 'member-1' })
    expect(fetchMock.mock.calls[1][0]).toBe('/clusters/member-1/api/v1/nodes')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(GROUPS_NS_PATH, { axis: 'cluster', cluster: 'member-1' })
    expect(fetchMock.mock.calls[2][0]).toBe('/clusters/member-1' + GROUPS_NS_PATH)
  })

  it('host 视图 GET 发 /clusters/host——不代猜、不复刻宿主 host 裸路径分支', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(NS_PATH, { axis: 'cluster', cluster: 'host' })
    expect(fetchMock.mock.calls[0][0]).toBe('/clusters/host' + NS_PATH)
  })

  it('member 数据面写不再由 SDK 拒绝——是否可写由服务端判定（原生 API 与 façade 语义不同）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { ok: true }))
    const r = await scopedApi.post('/api/v1/namespaces/dev/configmaps', { axis: 'cluster', cluster: 'member-1' }, {})
    expect(r.status).toBe(201)
    expect(fetchMock.mock.calls[0][0]).toBe('/clusters/member-1/api/v1/namespaces/dev/configmaps')

    // façade member 写会被服务端 rejectMemberMutation 挡（405），SDK 不预判
    fetchMock.mockResolvedValueOnce(jsonResponse(405, { message: 'member mutation rejected' }))
    const err = await scopedApi
      .post(NS_PATH, { axis: 'cluster', cluster: 'member-1' }, {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(RiseResourceError)
    expect(err.status).toBe(405)
  })

  it('消费轴写放行', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {}))
    await scopedApi.post(NS_PATH, { axis: 'consumption' }, { metadata: {} })
    expect(fetchMock.mock.calls[0][0]).toBe(NS_PATH)
  })

  it('204 与空 body 解析为 null，不抛 SyntaxError', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const res = await scopedApi.delete(NS_PATH + '/pod-a', { axis: 'consumption' })
    expect(res).toEqual({ data: null, status: 204 })
  })

  it('空 200 body 同样解析为 null', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    const res = await scopedApi.get(NS_PATH, { axis: 'consumption' })
    expect(res.data).toBeNull()
  })

  it('非 2xx 抛 RiseResourceError，message 从 body.message 提取', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'namespaces "team-a" is forbidden' }))
    const err = await scopedApi.get(NS_PATH, { axis: 'cluster', cluster: 'member-1' }).catch((e) => e)
    expect(err).toBeInstanceOf(RiseResourceError)
    expect(err.status).toBe(403)
    expect(err.message).toContain('forbidden')
    expect(err.body).toEqual({ message: 'namespaces "team-a" is forbidden' })
    expect(err.url).toBe(CLUSTER_NS_PATH)
    expect(err.method).toBe('GET')
  })

  it('HTTP/2 无 statusText 时回落到状态码', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, null, ''))
    const err = await scopedApi.get(NS_PATH, { axis: 'consumption' }).catch((e) => e)
    expect(err).toBeInstanceOf(RiseResourceError)
    expect(err.message).toBe('HTTP 500')
  })

  it('body.error 字段也能提取 message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'AlreadyExists' }))
    const err = await scopedApi.get(NS_PATH, { axis: 'consumption' }).catch((e) => e)
    expect(err.message).toBe('AlreadyExists')
  })

  it('网络失败抛 status=0 的 RiseResourceError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await scopedApi.get(NS_PATH, { axis: 'consumption' }).catch((e) => e)
    expect(err).toBeInstanceOf(RiseResourceError)
    expect(err.status).toBe(0)
  })

  it('AbortError 原样透传（不被包装）', async () => {
    const abort = new DOMException('Aborted', 'AbortError')
    fetchMock.mockRejectedValueOnce(abort)
    const err = await scopedApi
      .get(NS_PATH, { axis: 'consumption' }, { signal: new AbortController().signal })
      .catch((e) => e)
    expect(err).toBe(abort)
  })

  it('params 序列化：null/undefined/空串剔除，其余转 query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(
      NS_PATH,
      { axis: 'consumption' },
      { params: { limit: '100', continue: null, keyword: undefined, empty: '', page: 2 } },
    )
    expect(fetchMock.mock.calls[0][0]).toBe(NS_PATH + '?limit=100&page=2')
  })

  it('path 自带 query 与 params 合并（同名 params 覆盖），不产生双问号', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(NS_PATH + '?limit=10&sortBy=name', { axis: 'consumption' }, {
      params: { limit: '500' },
    })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith(NS_PATH + '?')).toBe(true)
    expect(url.match(/\?/g)).toHaveLength(1)
    expect(url).toContain('limit=500')
    expect(url).toContain('sortBy=name')
  })

  it('path 已有 query 值中的第二个 ? 不被截断', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(NS_PATH + '?fieldSelector=a?b', { axis: 'consumption' })
    expect(fetchMock.mock.calls[0][0]).toBe(NS_PATH + '?fieldSelector=a%3Fb')
  })

  it('params 为空对象时不产生问号', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(NS_PATH, { axis: 'consumption' }, { params: {} })
    expect(fetchMock.mock.calls[0][0]).toBe(NS_PATH)
  })

  it('POST body 序列化为 JSON，Content-Type application/json', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {}))
    await scopedApi.post(NS_PATH, { axis: 'consumption' }, { metadata: { name: 'x' } })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ metadata: { name: 'x' } }))
  })

  it('PATCH 用 merge-patch Content-Type（K8s 约定）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.patch(NS_PATH + '/pod-a', { axis: 'consumption' }, { spec: {} })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/merge-patch+json')
  })

  it('GET 不带 Content-Type / body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await scopedApi.get(NS_PATH, { axis: 'consumption' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it('非 JSON 错误 body 原文进 message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('plain text gateway error', { status: 502, statusText: 'Bad Gateway' }),
    )
    const err = await scopedApi.get(NS_PATH, { axis: 'consumption' }).catch((e) => e)
    expect(err.message).toContain('plain text gateway error')
  })
})

// ── 路径注入与编码防护（通用化后保持不变） ────────────────────────────────────

describe('buildResourcePath — dot segment 与编码注入', () => {
  const TRAVERSAL = '/api/v1/namespaces/dev/pods/../../../../../../../oapis/tenant.rise.io/v1alpha1/workspaces'

  it('dot segment 逃逸 API 根 → 拒绝（消费轴与供给轴都拒绝）', () => {
    // 实测 new URL(TRAVERSAL, base).pathname 会规范化掉多余段，必须在源头拒绝。
    expect(() => buildResourcePath(TRAVERSAL, { axis: 'consumption' })).toThrow(RiseResourcePathError)
    expect(() => buildResourcePath(TRAVERSAL, { axis: 'cluster', cluster: 'member-1' })).toThrow(
      RiseResourcePathError,
    )
  })

  it('单个 "." 段拒绝', () => {
    expect(() => buildResourcePath('/api/v1/namespaces/dev/./pods', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
  })

  it('%2e / %2f / %5c 编码形态拒绝', () => {
    for (const enc of ['%2e%2e', 'pods%2f..%2f..', '%2e/pods']) {
      expect(() => buildResourcePath('/api/v1/namespaces/dev/' + enc, { axis: 'consumption' })).toThrow(
        RiseResourcePathError,
      )
    }
  })

  it('控制字符拒绝', () => {
    const withCtrl = '/api/v1/namespaces/dev/pods' + String.fromCharCode(10)
    expect(() => buildResourcePath(withCtrl, { axis: 'consumption' })).toThrow(RiseResourcePathError)
  })

  it('裸 % / 非法百分号编码 → RiseResourcePathError 而非原始 URIError', () => {
    expect(() => buildResourcePath('/api/v1/namespaces/dev/pods/%', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
    expect(() => buildResourcePath('/api/v1/namespaces/dev/pods/%zz', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
  })

  it('反斜杠拒绝（浏览器按分隔符规范化，可绕过按 / 的段校验）', () => {
    expect(() => buildResourcePath('/api/v1/namespaces/dev\\..\\..\\other', { axis: 'consumption' })).toThrow(
      RiseResourcePathError,
    )
  })
})

describe('buildResourcePath — DNS1123 每段校验', () => {
  it('a..b（空段）拒绝——整体正则会放过，逐段校验不会', () => {
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'a..b' })).toThrow(RiseResourcePathError)
  })

  it('a.-b / a-.b（段首尾连字符）拒绝', () => {
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'a.-b' })).toThrow(RiseResourcePathError)
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'a-.b' })).toThrow(RiseResourcePathError)
  })

  it('合法多段（cluster.bj-1.prod）接受', () => {
    expect(buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'cluster.bj-1.prod' })).toBe(
      '/clusters/cluster.bj-1.prod' + NS_PATH,
    )
  })

  it('超长单段（64 字符 label）拒绝', () => {
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: 'a'.repeat(64) })).toThrow(
      RiseResourcePathError,
    )
  })

  it('整体超 253 拒绝（即使每段都合法）', () => {
    const long = Array.from({ length: 6 }, () => 'a'.repeat(42)).join('.')
    expect(long.length).toBeGreaterThan(253)
    expect(() => buildResourcePath(NS_PATH, { axis: 'cluster', cluster: long })).toThrow(RiseResourcePathError)
  })
})

// ── 401 重定向 ───────────────────────────────────────────────────────────────

describe('scopedApi 401 处理', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    // 最小 window 桩：记录 location 赋值
    ;(globalThis as any).window = {
      location: { pathname: '/workspace/team-a/project/dev/x', search: '?tab=pods', href: '' },
    }
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    delete (globalThis as any).window
  })

  it('401 跳 /login 带回跳地址（镜像宿主 apiClient 语义）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
    const err = await scopedApi.get(NS_PATH, { axis: 'consumption' }).catch((e) => e)
    expect(err).toBeInstanceOf(RiseResourceError)
    expect(err.status).toBe(401)
    const href = (globalThis as any).window.location.href as string
    expect(href.startsWith('/login?redirect=')).toBe(true)
    expect(decodeURIComponent(href.replace('/login?redirect=', ''))).toBe(
      '/workspace/team-a/project/dev/x?tab=pods',
    )
  })
})
