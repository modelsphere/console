// 「从镜像仓库进入实例创建」的 URL 契约。
//
// 镜像页与三类创建表单分属不同插件（registry / model-x / custom-service，
// 容器实例在框架 Console），插件之间不能 import 源码，所以只经 URL 交接：
//
//   <create-route>?create=1&imageRef=<host/path:tag>&imageTag=<tag>
//                  &imageSource=public|hosted|external
//                  &namespace=<project>&clusterId=<cluster>
//
// 规则（两侧都按这一份实现，单测锁死）：
//   - `create=1` 是开关；缺席时创建表单的行为与没有这套契约时完全一致。
//   - `imageRef` 是完整引用（含 tag），`imageTag` 必须与引用末尾的 tag 逐字相同。
//     任一缺失、为空、或两者不一致，整份预设作废 —— 宁可没有预选，也不塞半截引用。
//   - `imageSource` 只用于说明来源（public / hosted / external），不改变任何取数或
//     版本规则；缺失或未知按空串处理，预设仍然有效。
//   - `namespace` / `clusterId` 是可选的目标上下文。调用方只能把它们当「建议」：
//     创建页仍须按自己当前的集群与项目清单校验，不能把预设值直接当成已存在。
//   - 参数用 URLSearchParams 编码；读取方消费一次后从地址栏擦掉，避免刷新重开。

export type CreateInstanceTarget = 'container' | 'inference' | 'application'

export type CreateInstanceImageSource = 'public' | 'hosted' | 'external'

export interface CreateInstancePreset {
  /** 完整镜像引用：`host/path:tag` */
  imageRef: string
  /** 引用末尾的 tag */
  tag: string
  /** 来源说明；缺失或未知为空串 */
  source: CreateInstanceImageSource | ''
  /** 目标项目（建议值，创建页须自行校验） */
  namespace: string
  /** 目标集群（建议值，创建页须自行校验） */
  clusterId: string
}

/** 三类创建表单各自的落点。路径由宿主 navigate 自动补当前 scope 前缀。 */
export const CREATE_INSTANCE_ROUTES: Readonly<Record<CreateInstanceTarget, string>> = {
  container: '/core.rise.io/v1/tenant/deployments',
  inference: '/rise.io/v1/model-x/inferences',
  application: '/rise.io/v1/custom-service/services',
}

export const CREATE_INSTANCE_PARAM = 'create'
export const CREATE_INSTANCE_IMAGE_REF_PARAM = 'imageRef'
export const CREATE_INSTANCE_IMAGE_TAG_PARAM = 'imageTag'
export const CREATE_INSTANCE_IMAGE_SOURCE_PARAM = 'imageSource'
export const CREATE_INSTANCE_NAMESPACE_PARAM = 'namespace'
export const CREATE_INSTANCE_CLUSTER_PARAM = 'clusterId'

const SOURCES: readonly CreateInstanceImageSource[] = ['public', 'hosted', 'external']

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 拆开 `host[:port]/path:tag`。必须同时有主机、路径与 tag：任何一个空缺都返回 null，
 * 调用方据此判定「这还不是一个真能 pull 的引用」。
 */
export function splitImageRef(ref: string): { registry: string; repository: string; tag: string } | null {
  const value = text(ref)
  if (!value) return null
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return null
  const registry = value.slice(0, slash)
  const rest = value.slice(slash + 1)
  const colon = rest.lastIndexOf(':')
  if (colon <= 0 || colon === rest.length - 1) return null
  const repository = rest.slice(0, colon)
  const tag = rest.slice(colon + 1)
  if (!repository || !tag || tag.includes('/') || /\s/.test(value)) return null
  return { registry, repository, tag }
}

/** 预设是否自洽：完整引用，且 `imageTag` 与引用末尾的 tag 一致。 */
export function isValidCreateInstancePreset(preset: Pick<CreateInstancePreset, 'imageRef' | 'tag'>): boolean {
  const parts = splitImageRef(preset.imageRef)
  const tag = text(preset.tag)
  return !!parts && !!tag && parts.tag === tag
}

function sourceOf(value: string): CreateInstanceImageSource | '' {
  return (SOURCES as readonly string[]).includes(value) ? (value as CreateInstanceImageSource) : ''
}

/**
 * 三类入口的目标地址。预设不完整时返回空串：调用方据此禁用入口，而不是跳到
 * 一个没有预选的创建页。
 */
export function buildCreateInstanceUrl(target: CreateInstanceTarget, preset: CreateInstancePreset): string {
  const route = CREATE_INSTANCE_ROUTES[target]
  if (!route) return ''
  if (!isValidCreateInstancePreset(preset)) return ''
  const params = new URLSearchParams()
  params.set(CREATE_INSTANCE_PARAM, '1')
  params.set(CREATE_INSTANCE_IMAGE_REF_PARAM, text(preset.imageRef))
  params.set(CREATE_INSTANCE_IMAGE_TAG_PARAM, text(preset.tag))
  const source = sourceOf(text(preset.source))
  if (source) params.set(CREATE_INSTANCE_IMAGE_SOURCE_PARAM, source)
  const namespace = text(preset.namespace)
  if (namespace) params.set(CREATE_INSTANCE_NAMESPACE_PARAM, namespace)
  const clusterId = text(preset.clusterId)
  if (clusterId) params.set(CREATE_INSTANCE_CLUSTER_PARAM, clusterId)
  return `${route}?${params.toString()}`
}

/**
 * 创建页读取预设。缺席或残缺一律 null —— 这与「没有这套契约」是同一条路径，
 * 调用方不需要额外的开关。
 */
export function parseCreateInstancePreset(search: string): CreateInstancePreset | null {
  const params = new URLSearchParams(search || '')
  if (params.get(CREATE_INSTANCE_PARAM) !== '1') return null
  const imageRef = text(params.get(CREATE_INSTANCE_IMAGE_REF_PARAM))
  const tag = text(params.get(CREATE_INSTANCE_IMAGE_TAG_PARAM))
  if (!isValidCreateInstancePreset({ imageRef, tag })) return null
  return {
    imageRef,
    tag,
    source: sourceOf(text(params.get(CREATE_INSTANCE_IMAGE_SOURCE_PARAM))),
    namespace: text(params.get(CREATE_INSTANCE_NAMESPACE_PARAM)),
    clusterId: text(params.get(CREATE_INSTANCE_CLUSTER_PARAM)),
  }
}

/**
 * 消费一次后擦掉契约参数（保留页面自己的其它查询参数与历史记录语义）。
 * 返回是否真的擦掉了东西，调用方可据此决定要不要 replaceState。
 */
export function clearCreateInstanceParams(url: URL): boolean {
  // `namespace` / `clusterId` 也是页面自己的查询参数，擦掉会改变页面的筛选状态；
  // 只擦这条契约独占的四个参数。开关不在时什么都不做 —— 页面原有的查询串不受影响。
  if (url.searchParams.get(CREATE_INSTANCE_PARAM) !== '1') return false
  for (const name of [
    CREATE_INSTANCE_PARAM,
    CREATE_INSTANCE_IMAGE_REF_PARAM,
    CREATE_INSTANCE_IMAGE_TAG_PARAM,
    CREATE_INSTANCE_IMAGE_SOURCE_PARAM,
  ]) {
    url.searchParams.delete(name)
  }
  return true
}
