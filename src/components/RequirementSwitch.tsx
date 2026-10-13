import './RequirementSwitch.css'

/** Shared family requirement control for reviewed stages and disputed actions.
 * @see ../../docs/product/design-system.md#cards-and-status */
export default function RequirementSwitch({ checked, disabled = false, onChange, label = 'Учитывать пункт при проверке' }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label?: string
}) {
  return <button type="button" className="edu-requirement-switch" role="switch" aria-checked={checked}
    aria-label={label} title={checked ? 'Исключить из проверки' : 'Включить в проверку'} disabled={disabled}
    onClick={() => onChange(!checked)}>
    <span className="edu-requirement-switch-track" aria-hidden="true" />
  </button>
}
