// Reproduce the Jinja2 filters used by the original Flask templates so that
// dynamic values render identically to the source application. These are pure
// functions so parity can be asserted without a DOM.

/** Jinja `capitalize`: first character uppercased, remainder unchanged. */
export function jinjaCapitalize(value: unknown): string {
  const text = String(value ?? '')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/**
 * Jinja `truncate(150, True)`: strings of 155 characters or fewer are returned
 * unchanged (the default leeway of 5); longer strings are cut to 147
 * characters with `...` appended, for a total length of 150.
 */
export function jinjaTruncate150(value: unknown): string {
  const text = String(value ?? '')
  return text.length <= 155 ? text : `${text.slice(0, 147)}...`
}
