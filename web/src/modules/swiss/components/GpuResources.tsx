import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Info, Pencil, Plus, RefreshCw, Star, TriangleAlert, X } from "lucide-react";
import { api, type GPUScanRequest, type GPUSpec, type Node } from "@swiss/lib/api";
import { DEFAULT_GPU_CLASS, DEFAULT_GPU_ROW_CLASS, GPU_VENDORS, productClass, resourceProducts, scanNames, scanRequest, SET_DEFAULT_GPU_CLASS } from "@swiss/lib/gpu";
import { emptyGPURow, gpuEntryErrors, gpuRows, gpuTable, hasGPUErrors, inOrder, isVendorDefault, makeVendorDefault, vendorGroups, type GPURow } from "@swiss/lib/profile";
import { Badge } from "@swiss/components/ui/badge";
import { Button } from "@swiss/components/ui/button";
import { Dialog } from "@swiss/components/ui/dialog";
import { Input } from "@swiss/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@swiss/components/ui/table";
import { cn } from "@swiss/lib/utils";

const BAD = "border-destructive";
// nodes.gpus as a table, with the canonical products this cluster's nodes
// carry under each resource. A row opens in a dialog: its details, or with
// onChange its editor.
export function GpuTable({ gpus, onChange }: { gpus?: GPUSpec[]; onChange?: (next: GPUSpec[]) => void }) {
  // null adds a row; a number opens that one.
  const [open, setOpen] = useState<number | null | undefined>(undefined);
  // Rows stay where they were when the table opened: setting a default moves the badge, not the row.
  const [order, setOrder] = useState(() => (gpus ?? []).map((g) => g.resource));
  // Listing every node is heavy: read once, then only on refresh.
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const list = gpus ?? [];
  return (
    <div className="space-y-2">
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {gpus ? "None: a site without GPU resources. A GPU variant is refused here." : "Not set."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Vendor</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead title="Each vendor's default resource: what its pods request when no node carries the product asked for. A vendor with several resources picks one.">Default</TableHead>
              <TableHead>Product label</TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1">
                  On this cluster
                  <button
                    type="button"
                    aria-label="refresh nodes"
                    title={nodes.dataUpdatedAt ? `Nodes read at ${new Date(nodes.dataUpdatedAt).toLocaleTimeString()}` : "Refresh"}
                    disabled={nodes.isFetching}
                    onClick={() => nodes.refetch()}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={cn("size-3.5", nodes.isFetching && "animate-spin")} />
                  </button>
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
                    <Badge variant="outline" className={DEFAULT_GPU_CLASS} title={`What ${vendor} pods request when no node carries the product asked for`}>
                      <Star className="size-3 fill-current" />
                      default
                    </Badge>
                  ) : (
                    onChange && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={SET_DEFAULT_GPU_CLASS}
                        title={`What ${vendor} pods request when no node carries the product asked for`}
                        onClick={() => onChange(makeVendorDefault(list, i))}
                      >
                        <Star className="size-3" />
                        set as default
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
                      <IconButton label={`edit ${g.resource}`} onClick={() => setOpen(i)}>
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton label={`remove ${g.resource}`} danger onClick={() => onChange(list.filter((_, j) => j !== i))}>
                        <X className="size-4" />
                      </IconButton>
                    </>
                  ) : (
                    <IconButton label={`details of ${g.resource}`} onClick={() => setOpen(i)}>
                      <Info className="size-4" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      )}
      {onChange && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)} className="text-primary hover:text-primary">
          <Plus className="size-4" /> Add GPU resource
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
  if (!nodes) return <span className="text-muted-foreground">-</span>;
  const { products, unlabelled } = resourceProducts(nodes, resource);
  if (!products.length && !unlabelled) return <span className="text-xs text-muted-foreground">No node reports it</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {products.map((p) => (
        <Badge key={p} variant="outline" className={cn("font-mono font-normal", productClass(p))}>
          {p}
        </Badge>
      ))}
      {unlabelled > 0 && (
        <span className="text-xs text-muted-foreground">
          {unlabelled} node{unlabelled === 1 ? "" : "s"} without a product label
        </span>
      )}
    </span>
  );
}

function GpuDetail({ value: g, onClose }: { value: GPUSpec; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={<span className="font-mono">{g.resource}</span>}
      subtitle={
        <span>
          {g.vendor} · product label <code className="font-mono text-xs">{g.labelKey}</code>
        </span>
      }
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {g.products?.length ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Catalog GPU product</TableHead>
              <TableHead>Also named by</TableHead>
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
        <p className="text-xs text-muted-foreground">None defined: a node's label value is its product name.</p>
      )}
    </Dialog>
  );
}

function GpuDialog({ value, others, onClose, onSave }: { value?: GPUSpec; others: GPUSpec[]; onClose: () => void; onSave: (g: GPUSpec) => void }) {
  const [row, setRow] = useState<GPURow>(() => (value ? gpuRows([value])[0] : emptyGPURow()));
  const [submitted, setSubmitted] = useState(false);
  const errs = gpuEntryErrors(row, others);
  const bad = (e?: unknown) => submitted && !!e;
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
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={value ? "Edit GPU resource" : "Add GPU resource"}
      subtitle="A vendor's first resource is what its pods request when no node carries the product asked for. A product lists the label values that also name it; its own name always does."
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid items-center gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
          <Input
            className={cn(bad(errs.vendor) && BAD)}
            aria-invalid={bad(errs.vendor)}
            value={row.vendor}
            onChange={(e) => edit({ vendor: e.target.value })}
            list={vendorList}
            placeholder="vendor, e.g. nvidia"
            aria-label="GPU vendor"
          />
          <datalist id={vendorList}>
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <Input
            className={cn("font-mono text-xs", bad(errs.resource) && BAD)}
            aria-invalid={bad(errs.resource)}
            value={row.resource}
            onChange={(e) => edit({ resource: e.target.value })}
            placeholder="resource, e.g. nvidia.com/gpu"
            aria-label="GPU resource"
          />
          <Input
            className={cn("font-mono text-xs", bad(errs.labelKey) && BAD)}
            aria-invalid={bad(errs.labelKey)}
            value={row.labelKey}
            onChange={(e) => edit({ labelKey: e.target.value })}
            placeholder="product label, e.g. nvidia.com/gpu.product"
            aria-label="GPU product label"
          />
        </div>
        {row.products.map((p, k) => (
          <div key={k} className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <Input
              className={cn(bad(errs.products[k]?.product) && BAD)}
              aria-invalid={bad(errs.products[k]?.product)}
              value={p.product}
              onChange={(e) => editProduct(k, { product: e.target.value })}
              placeholder="catalog GPU product"
              aria-label="GPU product"
            />
            <Input
              className={cn("font-mono text-xs", bad(errs.products[k]?.values) && BAD)}
              aria-invalid={bad(errs.products[k]?.values)}
              value={p.values}
              onChange={(e) => editProduct(k, { values: e.target.value })}
              placeholder="other label values naming it, comma separated"
              aria-label="label values"
            />
            <IconButton label={`remove ${p.product || "product"}`} danger onClick={() => edit({ products: row.products.filter((_, j) => j !== k) })}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
        {submitted && hasGPUErrors([errs]) && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Needs a vendor, a resource not listed already and a product label; every product a name listed once, and no label value naming two products.
          </p>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => edit({ products: [...row.products, { product: "", values: "" }] })} className="text-primary hover:text-primary">
          <Plus className="size-4" /> Add product
        </Button>
        <NodeScan request={gpuTable([row]).map(scanRequest)[0]} />
      </div>
    </Dialog>
  );
}

// What the entry as edited reads on the nodes. Lists every node, so only on request.
function NodeScan({ request }: { request?: GPUScanRequest }) {
  const scan = useMutation({ mutationFn: (g: GPUScanRequest) => api.scanNodeGPUs(g).then((r) => ({ r, g })) });
  const done = scan.data;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        On this cluster
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ms-auto"
          title="Reads every node by this entry as edited. A heavy call, so only on request."
          disabled={!request?.resource || scan.isPending}
          onClick={() => request && scan.mutate(request)}
        >
          <RefreshCw className={cn("size-3.5", scan.isPending && "animate-spin")} /> Scan nodes
        </Button>
      </div>
      {scan.error ? (
        <p className="text-xs text-destructive">{scan.error.message}</p>
      ) : !done ? (
        <p className="text-xs text-muted-foreground">Scan to see the products this entry finds on the cluster's nodes, before saving.</p>
      ) : done.r.nodes === 0 ? (
        <p className="text-xs text-muted-foreground">No node has {done.r.resource} allocatable.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {plural(done.r.nodes, "node")} with this resource, {done.r.gpus} GPUs
          </p>
          {done.r.products.map((p) => (
            <div key={p.product} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={cn("font-mono font-normal", p.nodes ? productClass(p.product) : "text-muted-foreground")}>
                {p.product}
              </Badge>
              <span className="text-muted-foreground">
                {plural(p.nodes, "node")} · {p.gpus} GPUs
              </span>
              {scanNames(p).map((n) => (
                <span key={n.name} className={cn("font-mono", n.nodes ? "text-foreground" : "text-muted-foreground")}>
                  {n.name}: {plural(n.nodes, "node")}
                </span>
              ))}
            </div>
          ))}
          {done.r.unlabelled.nodes > 0 && (
            <p className="text-xs text-warning">
              {plural(done.r.unlabelled.nodes, "node")} without a {done.g.labelKey || "-"} value
            </p>
          )}
        </>
      )}
      {done && JSON.stringify(done.g) !== JSON.stringify(request) && <p className="text-xs text-warning">Edited since the scan: scan again to see the change.</p>}
    </div>
  );
}

function IconButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn("rounded-md p-1.5 text-muted-foreground transition-colors", danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground")}
    >
      {children}
    </button>
  );
}
