/** Reusable tabs for day and olympiad views.
 * @see ../../docs/shared/design/components.md */
export default function SharedTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return <div className="day-tabs" role="tablist" aria-label={label}>{options.map(option => <button type="button" role="tab" key={option.id} aria-selected={value === option.id} className={value === option.id ? 'active' : ''} onClick={() => onChange(option.id)}>{option.label}</button>)}</div>
}
