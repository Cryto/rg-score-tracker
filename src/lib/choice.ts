/**
 * A row of checkboxes that acts like radio buttons which can be turned off:
 * checking one unchecks the rest, and clicking the checked one again leaves
 * none selected. Style the row with the global .choice-picker class.
 */
export function singleChoice(inputs: HTMLInputElement[]) {
  for (const input of inputs) {
    input.addEventListener('change', () => {
      if (input.checked) for (const other of inputs) if (other !== input) other.checked = false;
    });
  }
  return {
    /** The checked input's value, or '' when none is. */
    get value() {
      return inputs.find((i) => i.checked)?.value ?? '';
    },
    set value(v: string) {
      for (const input of inputs) input.checked = input.value === v;
    },
  };
}
