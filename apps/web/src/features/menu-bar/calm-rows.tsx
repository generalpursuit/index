import { Component, useLayoutEffect, useRef, type ReactNode } from "react";

const motion = { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" };
const fadeOut = { duration: 150, easing: "ease-out", fill: "forwards" } as const;

/** Changes animate only where they are seen, and not for someone who reduces motion. */
function animates() {
  return (
    document.visibilityState === "visible" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Props<T> = { items: T[]; rowKey: (item: T) => string; children: (item: T) => ReactNode };
type Departure<T> = { id: number; item: T; top: number };
/** Each row's top on screen, by key. */
type Places = Map<string, number>;

/**
 * Keyed rows that change calmly while they are shown: rows that stay glide to their new places,
 * new rows fade in, and removed rows fade out where they were. Rows stay in the layout at once, so
 * sizes change in one step. The rows are direct children of a positioned scroller.
 */
export class CalmRows<T> extends Component<Props<T>, { departures: Departure<T>[] }> {
  override state: { departures: Departure<T>[] } = { departures: [] };
  private rows = new Map<string, HTMLElement>();
  private attachers = new Map<string, (row: HTMLElement | null) => void>();
  private departed = 0;

  // React's one chance to read the page before an update changes it, so the places include
  // moves made elsewhere in the same update, such as a pending row above giving way to its link.
  override getSnapshotBeforeUpdate(previous: Props<T>): Places | null {
    if (previous.items === this.props.items || !animates()) return null;
    return new Map([...this.rows].map(([key, row]) => [key, row.getBoundingClientRect().top]));
  }

  override componentDidUpdate(previous: Props<T>, _: unknown, places: Places | null) {
    if (!places) return;
    for (const [key, row] of this.rows) {
      const before = places.get(key);
      const shift = before === undefined ? 0 : before - row.getBoundingClientRect().top;
      if (before === undefined) row.animate([{ opacity: 0 }, { opacity: 1 }], motion);
      else if (Math.abs(shift) > 0.5)
        row.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], motion);
    }
    const kept = new Set(this.props.items.map(this.props.rowKey));
    const departures = previous.items.flatMap((item) => {
      const top = places.get(this.props.rowKey(item));
      return kept.has(this.props.rowKey(item)) || top === undefined
        ? []
        : [{ id: this.departed++, item, top }];
    });
    if (departures.length)
      this.setState(({ departures: old }) => ({ departures: [...old, ...departures] }));
  }

  private ref(key: string) {
    let ref = this.attachers.get(key);
    if (!ref) {
      ref = (row) => {
        if (row) this.rows.set(key, row);
        else {
          this.rows.delete(key);
          this.attachers.delete(key);
        }
      };
      this.attachers.set(key, ref);
    }
    return ref;
  }

  override render() {
    const { items, rowKey, children } = this.props;
    return (
      <>
        {items.map((item) => (
          <div key={rowKey(item)} ref={this.ref(rowKey(item))}>
            {children(item)}
          </div>
        ))}
        {this.state.departures.map(({ id, item, top }) => (
          <Departing
            key={"departing:" + id}
            top={top}
            onDone={() =>
              this.setState(({ departures }) => ({
                departures: departures.filter((departure) => departure.id !== id),
              }))
            }
          >
            {children(item)}
          </Departing>
        ))}
      </>
    );
  }
}

/** A removed row, over the rows that take its place, fading out where it was on screen. */
function Departing({
  top,
  onDone,
  children,
}: {
  top: number;
  onDone: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.style.top = `${top - element.getBoundingClientRect().top}px`;
    const fade = element.animate([{ opacity: 1 }, { opacity: 0 }], fadeOut);
    fade.finished.then(onDone, () => {});
    return () => fade.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-0 top-0" aria-hidden inert>
      {children}
    </div>
  );
}
