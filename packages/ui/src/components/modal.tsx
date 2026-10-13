import {
  Children,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "./drawer";
import { useMediaQuery } from "../hooks/use-media-query";

/** Surface and title typography shared by Modal and Confirmation. */
export const modalClassName =
  "app-dialog select-none bg-surface text-foreground border-border wrap-anywhere min-w-0 [&_.dialog-title]:font-serif [&_.dialog-title]:text-[26px] [&_.dialog-title]:font-bold [&_.dialog-title]:[font-variation-settings:'opsz'_60] [&_.dialog-title]:tracking-[-0.015em] [&_.dialog-title]:leading-[1.15]";

// Each replaces the dialog primitive's `sm:max-w-sm`, which would cap every size at small.
const modalSizes = {
  sm: "w-96 sm:max-w-[calc(100vw_-_32px)]",
  md: "w-150 sm:max-w-[calc(100vw_-_32px)]",
  lg: "w-162.5 sm:max-w-[calc(100vw_-_32px)]",
};
// Centered in the page below any window controls over its top (see --titlebar-inset), and
// bounded so a dialog's title and actions stay on screen.
export const modalCenter =
  "top-[calc(50%_+_var(--titlebar-inset)_/_2)] max-h-[min(640px,_calc(100dvh_-_80px_-_var(--titlebar-inset)))]";
const modalPositions = {
  center: modalCenter,
  // Content that grows as it loads extends downward from here instead of re-centering.
  top: "top-[calc(12dvh_+_var(--titlebar-inset))] translate-y-0 max-h-[calc(88dvh_-_20px_-_var(--titlebar-inset))]",
};
const fixedDialogHeight = "h-[min(640px,_calc(100dvh_-_80px_-_var(--titlebar-inset)))]";
// Content with its own action row marks it `modal-actions` and its Cancel `modal-cancel`; on
// sheets they behave like a ModalFooter's: Cancel hides and the actions fill the row.
const sheetActionRow =
  "[&_.modal-cancel]:hidden [&_.modal-actions_[data-slot=button]]:flex-1 [&_.modal-actions_[data-slot=button]]:min-h-11.5";

const ModalPresentation = createContext<"dialog" | "sheet" | undefined>(undefined);
/** How the modal around this content is shown; undefined outside one. */
export const useModalPresentation = () => useContext(ModalPresentation);

/**
 * A titled dialog on larger screens and a swipeable bottom sheet on phones. The title row stays
 * put while the children scroll beneath it; put actions in a `ModalFooter` to pin them below.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  children,
  className = "",
  size = "sm",
  position = "center",
  fixedHeight = false,
  returnFocus,
  onBack,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  /** Keeps the title for assistive technology when the content shows its own heading. */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: keyof typeof modalSizes;
  /** Dialogs only; sheets always rise from the bottom. */
  position?: keyof typeof modalPositions;
  /** For a list that loads or filters in place: the frame keeps its size while it changes. */
  fixedHeight?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  /** While set, Escape calls it instead of closing: a stacked view goes back to the one under it. */
  onBack?: () => void;
}) {
  const phone = useMediaQuery("(max-width: 700px)");
  const change = (next: boolean, { reason }: { reason: string }) => {
    if (!next && onBack && (reason === "escape-key" || reason === "close-watcher")) onBack();
    else onOpenChange(next);
  };
  const Title = phone ? DrawerTitle : DialogTitle;
  const Description = phone ? DrawerDescription : DialogDescription;
  // The insets are variables so the footer can reach the frame's edges from inside the body.
  const content = (
    <ModalPresentation.Provider value={phone ? "sheet" : "dialog"}>
      <div
        data-slot="modal-header"
        className={
          hideTitle ? "sr-only" : "flex flex-none flex-col gap-3 px-(--modal-inset) pt-1 pb-4"
        }
      >
        <Title className="dialog-title pr-10">{title}</Title>
        <Description className={description ? "muted text-subtle-foreground" : "sr-only"}>
          {description ?? title}
        </Description>
      </div>
      <div
        data-slot="modal-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-(--modal-inset) pt-1 pb-(--modal-bottom) has-[[data-slot=modal-footer]]:pb-0"
      >
        {children}
      </div>
    </ModalPresentation.Provider>
  );
  if (phone)
    return (
      <Drawer open={open} onOpenChange={change}>
        <DrawerContent
          finalFocus={returnFocus}
          className={
            modalClassName +
            " app-sheet relative flex min-h-0 w-full! max-w-full! flex-col gap-4 overflow-hidden rounded-t-[22px] border-t border-border [outline:0] pt-2.5 [--modal-inset:20px] [--modal-bottom:calc(20px_+_env(safe-area-inset-bottom,_0px))] max-h-full! [transform:translateY(var(--drawer-swipe-movement-y,_0px))] [transition:transform_450ms_cubic-bezier(0.32,_0.72,_0,_1)] [&[data-starting-style]]:[transform:translateY(100%)] [&[data-ending-style]]:[transform:translateY(100%)] [&[data-ending-style]]:duration-[calc(var(--drawer-swipe-strength)_*_400ms)] [&_[data-slot=drawer-close]]:absolute [&_[data-slot=drawer-close]]:top-7.5 [&_[data-slot=drawer-close]]:right-3.5 " +
            sheetActionRow +
            " " +
            (fixedHeight ? "h-full " : "") +
            className
          }
        >
          {content}
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        finalFocus={returnFocus}
        className={
          modalClassName +
          ` ${modalSizes[size]} ${modalPositions[position]} ${fixedHeight ? fixedDialogHeight : ""} flex flex-col gap-0 overflow-hidden rounded-[22px] p-0 pt-6 [--modal-inset:28px] [--modal-bottom:28px] [&_[data-slot='dialog-close']]:absolute [&_[data-slot='dialog-close']]:top-6.5 [&_[data-slot='dialog-close']]:right-5.5 ` +
          className
        }
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The modal's action row, pinned below the scrolling body. `onCancel` adds a Cancel action to
 * dialogs only: sheets are dismissed by swiping or their close button, and their actions fill
 * the row.
 */
export function ModalFooter({
  onCancel,
  children,
}: {
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const sheet = useContext(ModalPresentation) === "sheet";
  if (sheet && !Children.toArray(children).length) return null;
  return (
    <div
      data-slot="modal-footer"
      className={
        "sticky bottom-0 z-10 -mx-(--modal-inset) mt-auto flex flex-none items-center justify-end gap-2 bg-surface px-(--modal-inset) pt-3 pb-(--modal-bottom) " +
        (sheet
          ? "[&_[data-slot=button]]:min-h-11.5 [&_[data-slot=button]]:flex-1"
          : "[&_[data-slot=button]]:min-h-9.5 [&_[data-slot=button]]:px-4.5")
      }
    >
      {onCancel && !sheet && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
      {children}
    </div>
  );
}

/** One of the views a modal switches between; see `ModalViews`. */
export type ModalView = { id: string; content: ReactNode };
// The curve sheets move with.
const switchTiming = { duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
const control =
  "a[href], button:not(:disabled), input:not(:disabled):not([type='hidden']), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * Views stacked in one modal, the last one shown. The ones under it stay mounted but hidden, so
 * they come back as they were. Switching crossfades while the frame takes the new view's height.
 * Focus moves into the shown view (its first control in a dialog, the sheet itself on phones),
 * or back to where it was in a view shown again.
 */
export function ModalViews({ views }: { views: ModalView[] }) {
  const sheet = useContext(ModalPresentation) === "sheet",
    shown = views.at(-1)?.id;
  // The view shown before a switch fades out over the next; one that left the stack keeps its
  // last content until then.
  const [previous, setPrevious] = useState(views);
  const [leaving, setLeaving] = useState<ModalView & { stays: boolean }>();
  if (previous !== views) {
    setPrevious(views);
    const last = previous.at(-1);
    if (last && last.id !== shown)
      setLeaving({ ...last, stays: views.some((view) => view.id === last.id) });
  }
  const frame = useRef<HTMLDivElement>(null),
    height = useRef(0),
    focused = useRef(new Map<string, HTMLElement>());
  // The height a switch starts from.
  useLayoutEffect(() => {
    const element = frame.current!;
    const observer = new ResizeObserver(() => {
      height.current = element.offsetHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = frame.current!;
    const next = element.querySelector<HTMLElement>(":scope > [data-view='shown']"),
      fading = element.querySelector<HTMLElement>(":scope > [data-view='leaving']");
    if (!leaving || !shown || !next || !fading) return;
    // A covered view keeps what had focus in it, to get it back when it is shown again.
    const active = document.activeElement;
    if (leaving.stays && active instanceof HTMLElement && fading.contains(active))
      focused.current.set(leaving.id, active);
    const back = focused.current.get(shown);
    focused.current.delete(shown);
    const target =
      back?.isConnected && next.contains(back)
        ? back
        : sheet
          ? element.closest<HTMLElement>("[role='dialog']")
          : next.querySelector<HTMLElement>(control);
    target?.focus({ preventScroll: true });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLeaving(undefined);
      return;
    }
    // Until it has resized, the frame clips the views, and the shown one keeps its final height
    // instead of being squeezed or stretched along with the frame.
    const to = element.offsetHeight;
    Object.assign(element.style, { flex: "none", overflow: "clip" });
    Object.assign(next.style, { flex: "none", height: `${to}px` });
    const animations = [
      element.animate({ height: [`${height.current}px`, `${to}px`] }, switchTiming),
      next.animate({ opacity: [0, 1] }, switchTiming),
      fading.animate({ opacity: [1, 0] }, { ...switchTiming, fill: "forwards" }),
    ];
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => setLeaving(undefined),
      () => {},
    );
    return () => {
      for (const style of [element.style, next.style])
        Object.assign(style, { flex: "", overflow: "", height: "" });
      for (const animation of animations) animation.cancel();
    };
  }, [leaving, shown, sheet]);
  const rendered = leaving && !leaving.stays ? [...views, leaving] : views;
  return (
    <div ref={frame} data-slot="modal-views" className="relative flex min-h-0 flex-1 flex-col">
      {rendered.map((view) => {
        const state = view.id === shown ? "shown" : view.id === leaving?.id ? "leaving" : "covered";
        return (
          <div
            key={view.id}
            data-view={state}
            inert={state !== "shown"}
            className={
              state === "shown"
                ? "flex min-h-0 flex-1 flex-col"
                : state === "leaving"
                  ? "absolute inset-x-0 top-0"
                  : "hidden"
            }
          >
            {view.content}
          </div>
        );
      })}
    </div>
  );
}
