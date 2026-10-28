import './RequirementSwitch.css'

/** Shared family requirement control for reviewed stages and disputed actions.
 * @see ../../docs/shared/design/README.md#cards-and-status */
export default function RequirementSwitch({ checked, disabled = false, onChange, label = 'Учитывать пункт при проверке', onTitle = 'Исключить из проверки', offTitle = 'Включить в проверку' }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label?: string; onTitle?: string; offTitle?: string
}) {
  return <button type="button" className="edu-requirement-switch" role="switch" aria-checked={checked}
    aria-label={label} title={checked ? onTitle : offTitle} disabled={disabled}
    onClick={() => onChange(!checked)}>
    <span className="edu-requirement-switch-track" aria-hidden="true" />
  </button>
}
