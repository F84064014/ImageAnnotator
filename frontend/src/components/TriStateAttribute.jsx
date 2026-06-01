import { useEffect, useRef } from 'react';
import { ATTRIBUTE_COLORS, ATTRIBUTE_STATES } from '../constants/attributes';
import { normalizeAttributeValue } from '../utils/attributes';

export default function TriStateAttribute({ label, value, onChange }) {
  const checkboxRef = useRef(null);
  const normalizedValue = normalizeAttributeValue(value);
  const color = ATTRIBUTE_COLORS[label.trim().toLowerCase()];
  const rowStyle = color ? { '--attribute-color': color } : undefined;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = normalizedValue === 2;
    }
  }, [normalizedValue]);

  function cycleState(event) {
    event.preventDefault();
    onChange(ATTRIBUTE_STATES[normalizedValue].next);
  }

  return (
    <label
      className={`attributeRow attributeState${normalizedValue} ${color ? 'attributeColorRow' : ''}`}
      style={rowStyle}
      onMouseDown={(event) => event.preventDefault()}
    >
      <input
        ref={checkboxRef}
        type="checkbox"
        tabIndex={-1}
        checked={normalizedValue === 1}
        readOnly
        onClick={cycleState}
      />
      {color && <span className="attributeColorSwatch" aria-hidden="true" />}
      <span>{label}</span>
      <em>{ATTRIBUTE_STATES[normalizedValue].label}</em>
    </label>
  );
}
