/**
 * Container key handlers (a list's Enter, a dialog-wide shortcut) must leave keys to the
 * control that has focus: Enter on a focused "Uninstall" button presses that button, not the
 * list's install shortcut (bug hunt BH-15, BH-17). Call this first in any `onKeyDown` set on a
 * wrapper that also holds buttons; the container's own search box (`own`) is not a control.
 */
const CONTROL =
  'button, a[href], select, textarea, summary, [contenteditable=""], [contenteditable="true"], input:not([type="search"]):not([type="text"]):not([role="combobox"]), [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="tab"], [role="link"]';

export function keyBelongsToControl(
  event: { target: EventTarget | null; currentTarget: EventTarget | null },
  own?: Element | null,
): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target === event.currentTarget || target === own) {
    return false;
  }
  const control = target.closest(CONTROL);
  return (
    !!control &&
    control !== own &&
    control !== event.currentTarget &&
    (event.currentTarget instanceof Element
      ? event.currentTarget.contains(control)
      : true)
  );
}
