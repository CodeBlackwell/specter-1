type Option = { value: string; label: string };

type Props = {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<Option>;
  label?: string;
};

export function Tabs({ value, onChange, options, label }: Props) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          type="button"
          aria-selected={opt.value === value}
          className="tabs__tab"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
