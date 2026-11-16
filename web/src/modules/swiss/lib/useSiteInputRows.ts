import { useState } from "react";
import type { SiteProfile } from "./api";
import {
  sameSiteInputs,
  siteInputRowErrors,
  siteInputRows,
  siteInputsFromRows,
  type SiteInputError,
  type SiteInputRow,
} from "./inputs";

// Keeps editable rows locally so typing numbers ("00") or blank rows does not jump
// mid-edit, while syncing when the profile's inputs change from outside.
export function useSiteInputRows(
  value: SiteProfile["inputs"] | undefined,
  onChange: (v: SiteProfile["inputs"] | undefined) => void,
) {
  const [rows, setRows] = useState<SiteInputRow[]>(() => siteInputRows(value));
  const [prev, setPrev] = useState(value);
  if (!sameSiteInputs(value, prev)) {
    setPrev(value);
    setRows(siteInputRows(value));
  }
  const update = (next: SiteInputRow[]) => {
    const inputs = siteInputsFromRows(next);
    setRows(next);
    setPrev(inputs);
    onChange(inputs);
  };
  const errors: (SiteInputError | undefined)[] = siteInputRowErrors(rows);
  const add = () => setRows([...rows, { key: "", value: "" }]);
  const edit = (index: number, patch: Partial<SiteInputRow>) =>
    update(rows.map((r, j) => (j === index ? { ...r, ...patch } : r)));
  const remove = (index: number) => update(rows.filter((_, j) => j !== index));
  return { rows, errors, add, edit, remove };
}
