import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldInput,
  FloatingField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@modelsphere/ui";
import { Info, Pencil, Plus, RefreshCw, Star, X } from "lucide-react";
import { api, type GPUSpec, type Node } from "@swiss/lib/api";
import { DEFAULT_GPU_CLASS, DEFAULT_GPU_ROW_CLASS, GPU_VENDORS, productClass, resourceProducts, SET_DEFAULT_GPU_CLASS } from "@swiss/lib/gpu";
import { emptyGPURow, gpuEntryErrors, gpuRows, gpuTable, hasGPUErrors, inOrder, isVendorDefault, makeVendorDefault, vendorGroups, type GPUError, type GPURow } from "@swiss/lib/profile";
import { useT } from "@/modules/inferences/i18n";

// nodes.gpus as a table, with the canonical products this cluster's nodes
// carry under each resource. A row opens in a dialog: its details, or with
// onChange its editor.
export function GpuTable({ gpus, onChange }: { gpus?: GPUSpec[]; onChange?: (next: GPUSpec[]) => void }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  // null adds a row; a number opens that one.
  const [open, setOpen] = useState<number | null | undefined>(undefined);
  // Rows stay where they were when the table opened: setting a default moves the badge, not the row.
  const [order, setOrder] = useState(() => (gpus ?? []).map((g) => g.resource));
  // Listing every node is heavy: read once, then only on refresh.
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const list = gpus ?? [];
  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{gpus ? f("gpusNone") : t("profile.unset")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{f("gpuVendor")}</TableHead>
              <TableHead>{f("gpuResource")}</TableHead>
              <TableHead title={f("gpuDefaultColumnHint")}>{f("gpuDefault")}</TableHead>
              <TableHead>{f("gpuLabelKey")}</TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1">
                  {f("gpuClusterProducts")}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("common:actions.refresh")}
                    title={nodes.dataUpdatedAt ? t("profile.fields.gpuNodesReadAt", { time: new Date(nodes.dataUpdatedAt).toLocaleTimeString() }) : t("common:actions.refresh")}
                    disabled={nodes.isFetching}
                    onClick={() => nodes.refetch()}
                  >
                    <RefreshCw className={cn("size-3.5", nodes.isFetching && "animate-spin")} />
                  </Button>
                </span>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendorGroups(inOrder(list, order)).map(({ vendor, entries }) =>
              entries.map(({ entry: g, index: i }, k) => (
              <TableRow key={g.resource} className={cn(entries.length > 1 && isVendorDefault(list, i) && DEFAULT_GPU_ROW_CLASS)}>
                {k === 0 && (
                  <TableCell rowSpan={entries.length} className="align-top font-medium">
                    {vendor}
                  </TableCell>
                )}
                <TableCell className="font-mono text-xs">{g.resource}</TableCell>
                <TableCell>
                  {/* A vendor with one resource has no choice to show. */}
                  {entries.length === 1 ? null : isVendorDefault(list, i) ? (
                    <Badge variant="outline" className={DEFAULT_GPU_CLASS} title={t("profile.fields.gpuDefaultHint", { vendor })}>
                      <Star className="size-3 fill-current" />
                      {f("gpuDefault")}
                    </Badge>
                  ) : (
                    onChange && (
                      <Button variant="outline" size="sm" className={SET_DEFAULT_GPU_CLASS} title={t("profile.fields.gpuDefaultHint", { vendor })} onClick={() => onChange(makeVendorDefault(list, i))}>
                        <Star className="size-3" />
                        {f("gpuMakeDefault")}
                      </Button>
                    )
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{g.labelKey}</TableCell>
                <TableCell>
                  <ClusterProducts nodes={nodes.data?.nodes} resource={g.resource} />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {onChange ? (
                    <>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.edit")} onClick={() => setOpen(i)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.delete")} onClick={() => onChange(list.filter((_, j) => j !== i))}>
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="icon" className="size-8" aria-label={f("gpuShow")} onClick={() => setOpen(i)}>
                      <Info className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      )}
      {onChange && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setOpen(null)}>
          <Plus className="size-3.5" /> {f("gpuAdd")}
        </Button>
      )}
      {open !== undefined &&
        (onChange ? (
          <GpuDialog
            value={open === null ? undefined : list[open]}
            others={list.filter((_, j) => j !== open)}
            onClose={() => setOpen(undefined)}
            onSave={(g) => {
              if (open !== null) setOrder((o) => o.map((r) => (r === list[open].resource ? g.resource : r)));
              onChange(open === null ? [...list, g] : list.map((x, j) => (j === open ? g : x)));
              setOpen(undefined);
            }}
          />
        ) : (
          open !== null && <GpuDetail value={list[open]} onClose={() => setOpen(undefined)} />
        ))}
    </div>
  );
}

// The nodes are read by the saved profile's table, so a resource added in the
// form shows none until it is saved.
function ClusterProducts({ nodes, resource }: { nodes?: Node[]; resource: string }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  if (!nodes) return <span className="text-muted-foreground">-</span>;
  const { products, unlabelled } = resourceProducts(nodes, resource);
  if (!products.length && !unlabelled) return <span className="text-xs text-muted-foreground">{f("gpuNoNodes")}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {products.map((p) => (
        <Badge key={p} variant="outline" className={cn("font-mono font-normal", productClass(p))}>
          {p}
        </Badge>
      ))}
      {unlabelled > 0 && <span className="text-xs text-muted-foreground">{t("profile.fields.gpuUnlabelled", { n: unlabelled })}</span>}
    </span>
  );
}

function GpuDetail({ value: g, onClose }: { value: GPUSpec; onClose: () => void }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{g.resource}</DialogTitle>
          <DialogDescription>
            {g.vendor} · {f("gpuLabelKey")} <code className="font-mono text-xs">{g.labelKey}</code>
          </DialogDescription>
        </DialogHeader>
        {g.products?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{f("gpuProduct")}</TableHead>
                <TableHead>{f("gpuValues")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.products.map((p) => (
                <TableRow key={p.product}>
                  <TableCell>{p.product}</TableCell>
                  <TableCell className="font-mono text-xs">{p.values?.join(", ") || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground">{f("gpuNoDefinedProducts")}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GpuDialog({ value, others, onClose, onSave }: { value?: GPUSpec; others: GPUSpec[]; onClose: () => void; onSave: (g: GPUSpec) => void }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const [row, setRow] = useState<GPURow>(() => (value ? gpuRows([value])[0] : emptyGPURow()));
  const [submitted, setSubmitted] = useState(false);
  const errs = gpuEntryErrors(row, others);
  const err = (e?: GPUError) => (submitted && e ? t(`profile.errors.gpu.${e}`) : undefined);
  const edit = (patch: Partial<GPURow>) => setRow((r) => ({ ...r, ...patch }));
  const editProduct = (k: number, patch: Partial<GPURow["products"][number]>) => edit({ products: row.products.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
  // Any vendor goes: these are only suggestions.
  const vendors = [...new Set([...GPU_VENDORS, ...others.map((o) => o.vendor)])];
  const vendorList = useId();
  const save = () => {
    setSubmitted(true);
    if (!hasGPUErrors([errs])) onSave(gpuTable([row])[0]);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{value ? f("gpuEdit") : f("gpuAdd")}</DialogTitle>
          <DialogDescription>{f("gpusHint")}</DialogDescription>
        </DialogHeader>
        {/* An error line hangs below its field, so rows showing one need the room. */}
        <div className={`flex flex-col ${submitted && hasGPUErrors([errs]) ? "gap-5" : "gap-3"}`}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)]">
            <FloatingField label={f("gpuVendor")} required error={err(errs.vendor)}>
              <FieldInput value={row.vendor} onChange={(e) => edit({ vendor: e.target.value })} list={vendorList} placeholder="nvidia" />
            </FloatingField>
            <datalist id={vendorList}>
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <FloatingField label={f("gpuResource")} required error={err(errs.resource)}>
              <FieldInput value={row.resource} onChange={(e) => edit({ resource: e.target.value })} placeholder="nvidia.com/gpu" className="font-mono text-xs" />
            </FloatingField>
            <FloatingField label={f("gpuLabelKey")} hint={f("gpuLabelKeyHint")} required error={err(errs.labelKey)}>
              <FieldInput value={row.labelKey} onChange={(e) => edit({ labelKey: e.target.value })} placeholder="nvidia.com/gpu.product" className="font-mono text-xs" />
            </FloatingField>
          </div>
          {row.products.map((p, k) => (
            // Narrow, the remove button sits beside the product and the values take the next line.
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
              <FloatingField label={f("gpuProduct")} required error={err(errs.products[k]?.product)}>
                <FieldInput value={p.product} onChange={(e) => editProduct(k, { product: e.target.value })} placeholder="Ascend-910B3" />
              </FloatingField>
              <span className="sm:order-last">
                <Button variant="ghost" size="icon" className="size-8" aria-label={t("common:actions.delete")} onClick={() => edit({ products: row.products.filter((_, j) => j !== k) })}>
                  <X className="size-4" />
                </Button>
              </span>
              <div className="col-span-2 sm:col-span-1">
                <FloatingField label={f("gpuValues")} hint={f("gpuValuesHint")} error={err(errs.products[k]?.values)}>
                  <FieldInput value={p.values} onChange={(e) => editProduct(k, { values: e.target.value })} placeholder="module-910b-8, Ascend910B3" className="font-mono text-xs" />
                </FloatingField>
              </div>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => edit({ products: [...row.products, { product: "", values: "" }] })}>
            <Plus className="size-3.5" /> {f("gpuProductAdd")}
          </Button>
        </div>
        <NodeScan spec={gpuTable([row])[0]} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={save}>{t("common:actions.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// What the entry as edited reads on the nodes. Lists every node, so only on request.
function NodeScan({ spec }: { spec?: GPUSpec }) {
  const t = useT();
  const f = (k: string) => t(`profile.fields.${k}`);
  const scan = useMutation({ mutationFn: (g: GPUSpec) => api.scanNodeGPUs(g).then((r) => ({ r, g })) });
  const done = scan.data;
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-surface-page p-3">
      <div className="flex items-center gap-2 text-sm">
        {f("gpuClusterProducts")}
        <Button variant="outline" size="sm" className="ms-auto" title={f("gpuScanHint")} disabled={!spec?.resource || scan.isPending} onClick={() => spec && scan.mutate(spec)}>
          <RefreshCw className={cn("size-3.5", scan.isPending && "animate-spin")} /> {f("gpuScan")}
        </Button>
      </div>
      {scan.error ? (
        <p className="text-xs text-destructive">{scan.error.message}</p>
      ) : !done ? (
        <p className="text-xs text-muted-foreground">{f("gpuScanIdle")}</p>
      ) : done.r.nodes === 0 ? (
        <p className="text-xs text-muted-foreground">{t("profile.fields.gpuScanNone", { resource: done.r.resource })}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("profile.fields.gpuScanSummary", { nodes: done.r.nodes, gpus: done.r.gpus })}</p>
          {done.r.products.map((p) => (
            <div key={p.product} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={cn("font-mono font-normal", productClass(p.product))}>
                {p.product}
              </Badge>
              <span className="text-muted-foreground">{t("profile.fields.gpuScanCount", { nodes: p.nodes, gpus: p.gpus })}</span>
              {p.values?.some((v) => v !== p.product) && (
                <span className="font-mono text-muted-foreground">{t("profile.fields.gpuScanValues", { values: p.values.filter((v) => v !== p.product).join(", ") })}</span>
              )}
            </div>
          ))}
          {done.r.unlabelled.nodes > 0 && <p className="text-xs text-warning">{t("profile.fields.gpuScanUnlabelled", { nodes: done.r.unlabelled.nodes, label: done.g.labelKey || "-" })}</p>}
        </>
      )}
      {done && JSON.stringify(done.g) !== JSON.stringify(spec) && <p className="text-xs text-warning">{f("gpuScanStale")}</p>}
    </div>
  );
}
