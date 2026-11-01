import { useRef, useState, type ReactNode } from "react";
import { Select } from "@cloudflare/kumo/components/select";

type Option<Value extends string> = {
  value: Value;
  label: string;
  description?: string;
  icon?: ReactNode;
};

type SelectFieldProps<Value extends string> = {
  label: string;
  options: readonly Option<Value>[];
  value?: Value;
  defaultValue?: Value;
  onValueChange?: (value: Value) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  caption?: string;
  icon?: ReactNode;
};

export function SelectField<Value extends string>({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled,
  required,
  placeholder,
  className = "",
  caption,
  icon,
}: SelectFieldProps<Value>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <div className="select-field">
      <Select<Value>
        aria-label={label}
        className={`select-trigger ${className}`}
        name={name}
        value={value}
        defaultValue={
          value === undefined ? (defaultValue ?? options[0]?.value) : undefined
        }
        disabled={disabled || options.length === 0}
        required={required}
        placeholder={
          placeholder ??
          options.find((option) => option.value === "")?.label ??
          "Choose an option"
        }
        items={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        render={<button ref={trigger} />}
        renderValue={(selected) => {
          const option = options.find((item) => item.value === selected);
          if (!option) return null;
          return (
            <span className="select-value">
              {option.icon ?? icon}
              <span className="select-value-text">
                {caption && <small>{caption}</small>}
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
            </span>
          );
        }}
        container={container}
        positionMethod="fixed"
        collisionPadding={12}
        onOpenChange={(open) => {
          if (open) setContainer(trigger.current?.closest("dialog") ?? null);
        }}
        onValueChange={(next) => {
          if (next !== null) onValueChange?.(next);
        }}
      >
        {options.map((option) => (
          <Select.Option
            key={option.value}
            value={option.value}
            className="select-option"
          >
            <span className="select-option-content">
              {option.icon}
              <span className="select-option-text">
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
            </span>
          </Select.Option>
        ))}
      </Select>
    </div>
  );
}
