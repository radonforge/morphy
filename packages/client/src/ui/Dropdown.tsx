import type React from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { closedDropdown, type DropdownState, dropdownKey } from "./dropdownKeys";

const LIST_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

export interface DropdownOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface DropdownProps<T extends string> {
  readonly value: T;
  readonly options: readonly DropdownOption<T>[];
  readonly onChange: (value: T) => void;
  readonly label: string;
}

/**
 * Lays the open list under its trigger, or over it when the viewport has no room below. The list
 * is fixed to the viewport and portalled to `body`, so no pane's overflow clips it and it stacks
 * above every pane; it is kept inside the viewport and scrolls when taller than it.
 */
function placeList(trigger: HTMLElement, list: HTMLElement): void {
  const box = trigger.getBoundingClientRect();
  const height = list.offsetHeight;
  const below = window.innerHeight - box.bottom - LIST_GAP_PX - VIEWPORT_MARGIN_PX;
  const above = box.top - LIST_GAP_PX - VIEWPORT_MARGIN_PX;
  const top =
    height > below && above > below ? box.top - LIST_GAP_PX - height : box.bottom + LIST_GAP_PX;
  list.style.top = `${top}px`;
  const left = Math.min(box.left, window.innerWidth - list.offsetWidth - VIEWPORT_MARGIN_PX);
  list.style.left = `${Math.max(VIEWPORT_MARGIN_PX, left)}px`;
  list.style.minWidth = `${box.width}px`;
}

/**
 * The game's replacement for a native `<select>`: a WAI-ARIA select-only combobox. Focus never
 * leaves the trigger, which names the option the keyboard is on through `aria-activedescendant`,
 * so closing (by a pick, Escape, a click outside or blur) always leaves focus where it was. While
 * the list is open no key reaches the window's listeners, so neither the lobby nor a match acts
 * on keys meant for the list.
 */
export function Dropdown<T extends string>({ value, options, onChange, label }: DropdownProps<T>) {
  const id = useId();
  const listId = `${id}list`;
  const optionId = (index: number) => `${id}option-${index}`;
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [state, setState] = useState<DropdownState>(() => closedDropdown(selected));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setState(closedDropdown(selected)), [selected]);

  const commit = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  };

  useEffect(() => {
    if (!state.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (triggerRef.current?.contains(target) || listRef.current?.contains(target))
      ) {
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [state.open, close]);

  useLayoutEffect(() => {
    if (!state.open) return;
    const place = () => {
      if (triggerRef.current && listRef.current) placeList(triggerRef.current, listRef.current);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [state.open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (state.open) event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const outcome = dropdownKey(state, event.key, options.length, selected);
    if (outcome.handled) {
      event.preventDefault();
      event.stopPropagation();
    }
    setState(outcome.state);
    if (outcome.commit !== null) commit(outcome.commit);
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " ") event.preventDefault();
  };

  const onTriggerClick = () => {
    triggerRef.current?.focus();
    setState(state.open ? closedDropdown(selected) : { open: true, active: selected });
  };

  const onListClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const option =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-index]") : null;
    if (!option) return;
    const index = Number(option.dataset.index);
    commit(index);
    setState(closedDropdown(index));
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`dropdown${state.open ? " open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={state.open}
        aria-controls={state.open ? listId : undefined}
        aria-activedescendant={state.open ? optionId(state.active) : undefined}
        onClick={onTriggerClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={close}
      >
        <span className="dropdown-value">{options[selected]?.label}</span>
        <svg className="dropdown-chevron" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {state.open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="dropdown-list"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onListClick}
            onKeyDown={onKeyDown}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                data-index={index}
                aria-selected={index === selected}
                className={`dropdown-option${index === state.active ? " active" : ""}`}
                onPointerEnter={() => {
                  if (state.active !== index) setState({ open: true, active: index });
                }}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
