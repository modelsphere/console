import { Switch as RiseSwitch } from "@riseaicloud/ui";

// Rise's Switch takes onCheckedChange and forwards no other props, so the
// label cannot reach the control: it goes in a wrapping <label> instead, where
// it both names the switch and makes the text a hit target.
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center">
      <RiseSwitch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span className="sr-only">{label}</span>
    </label>
  );
}
