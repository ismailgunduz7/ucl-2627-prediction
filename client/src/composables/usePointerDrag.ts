import { onUnmounted, ref } from 'vue';

/**
 * Pick a thing up and drop it somewhere else, with a mouse or with a finger.
 *
 * The `draggable` attribute and the drag events that come with it never fire on
 * touch, so a phone would be left with no way to move anything at all. This
 * drives the whole gesture from pointer and touch events instead. A mouse
 * starts dragging as soon as it travels a few pixels; a finger has to rest on
 * the card first, so a flick still scrolls the page.
 *
 * A drop target marks itself with `data-drop-zone="<id>"`. Whatever sits under
 * the pointer wins, so zones can nest.
 */

/** How far a mouse travels before a press becomes a drag. */
const MOUSE_THRESHOLD = 5;
/** How far a finger may wander during the hold before we call it a scroll. */
const TOUCH_SLOP = 10;
/** How long a finger rests before the card lifts. */
const HOLD_MS = 220;
/** How close to the top or bottom edge the page starts scrolling itself. */
const EDGE = 72;
/** Auto-scroll speed, in pixels per frame, right at the edge. */
const EDGE_SPEED = 14;

interface Options {
  /** Whether a drag may start at all right now. A locked week says no. */
  enabled: () => boolean;
  /** The drag ended over a zone. Same id on both sides is filtered out already. */
  onDrop: (dragId: string, zoneId: string) => void;
}

export function usePointerDrag({ enabled, onDrop }: Options) {
  /** The id being carried, or null when nothing is in the air. */
  const dragId = ref<string | null>(null);
  /** The zone under the pointer while carrying. */
  const overZone = ref<string | null>(null);

  let pendingId: string | null = null;
  let pendingEl: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;
  let holdTimer: number | undefined;
  let originX = 0;
  let originY = 0;
  let grabX = 0;
  let grabY = 0;
  let lastX = 0;
  let lastY = 0;
  let scroller: number | undefined;
  /** A drag just ended, so the click the browser is about to fire is not a tap. */
  let swallowClick = false;

  function zoneAt(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>('[data-drop-zone]')?.dataset.dropZone ?? null;
  }

  /**
   * A finger cannot scroll the page while it is carrying something, so the
   * page scrolls itself when the drag reaches the top or bottom of the window.
   * Without this the bench box below the fold would be out of reach.
   */
  function autoScroll() {
    scroller = requestAnimationFrame(autoScroll);
    if (!dragId.value) return;
    const height = window.innerHeight;
    let dy = 0;
    if (lastY < EDGE) dy = -EDGE_SPEED * (1 - lastY / EDGE);
    else if (lastY > height - EDGE) dy = EDGE_SPEED * (1 - (height - lastY) / EDGE);
    if (!dy) return;
    window.scrollBy(0, dy);
    overZone.value = zoneAt(lastX, lastY);
  }

  function moveTo(x: number, y: number) {
    lastX = x;
    lastY = y;
    if (ghost) {
      ghost.style.transform = `translate3d(${x - grabX}px, ${y - grabY}px, 0) scale(1.04) rotate(-2deg)`;
    }
    overZone.value = zoneAt(x, y);
  }

  function lift(x: number, y: number) {
    if (!pendingId || !pendingEl) return;
    const box = pendingEl.getBoundingClientRect();
    grabX = x - box.left;
    grabY = y - box.top;

    ghost = pendingEl.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    document.body.appendChild(ghost);
    document.body.classList.add('is-dragging');

    dragId.value = pendingId;
    // A short buzz tells a finger the card came off the pitch.
    if ('vibrate' in navigator) navigator.vibrate?.(12);
    moveTo(x, y);
    scroller = requestAnimationFrame(autoScroll);
  }

  /** Puts everything back, and runs the drop if the card was in the air. */
  function release(dropped: boolean) {
    window.clearTimeout(holdTimer);
    if (scroller !== undefined) cancelAnimationFrame(scroller);
    scroller = undefined;
    detach();

    const id = dragId.value;
    const zone = overZone.value;

    ghost?.remove();
    ghost = null;
    document.body.classList.remove('is-dragging');
    dragId.value = null;
    overZone.value = null;
    pendingId = null;
    pendingEl = null;

    if (dropped && id && zone && zone !== id) onDrop(id, zone);
  }

  function onMouseMove(e: PointerEvent) {
    if (!dragId.value) {
      if (Math.hypot(e.clientX - originX, e.clientY - originY) < MOUSE_THRESHOLD) return;
      lift(e.clientX, e.clientY);
    }
    moveTo(e.clientX, e.clientY);
  }

  function onMouseUp() {
    const wasDragging = dragId.value !== null;
    release(wasDragging);
    if (!wasDragging) return;
    // The browser is about to fire a click on whatever the press started over.
    // Eat that one, and only that one.
    swallowClick = true;
    window.setTimeout(() => (swallowClick = false));
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    if (!dragId.value) {
      // Still deciding. A finger that travels is scrolling, not dragging.
      if (Math.hypot(t.clientX - originX, t.clientY - originY) > TOUCH_SLOP) release(false);
      return;
    }
    // Hold the page still while the card follows the finger.
    e.preventDefault();
    moveTo(t.clientX, t.clientY);
  }

  function onTouchEnd(e: TouchEvent) {
    const wasDragging = dragId.value !== null;
    // Preventing the default here stops the tap the browser would otherwise
    // synthesise on whatever ended up underneath the finger, so the click
    // guard the mouse path needs would only eat the next real tap.
    if (wasDragging) e.preventDefault();
    release(wasDragging);
  }

  function onClickCapture(e: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function swallowContextMenu(e: Event) {
    if (dragId.value || pendingId) e.preventDefault();
  }

  function detach() {
    window.removeEventListener('pointermove', onMouseMove);
    window.removeEventListener('pointerup', onMouseUp);
    window.removeEventListener('pointercancel', onMouseUp);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('contextmenu', swallowContextMenu);
  }

  /** Bind to `pointerdown` on anything that can be picked up. */
  function press(e: PointerEvent, id: string) {
    if (!enabled() || dragId.value || pendingId) return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A press on a control inside the card is a press on that control.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, [data-no-drag]')) return;

    pendingId = id;
    pendingEl = e.currentTarget as HTMLElement;
    originX = e.clientX;
    originY = e.clientY;

    window.addEventListener('contextmenu', swallowContextMenu);
    window.addEventListener('click', onClickCapture, true);

    if (e.pointerType === 'mouse') {
      window.addEventListener('pointermove', onMouseMove);
      window.addEventListener('pointerup', onMouseUp);
      window.addEventListener('pointercancel', onMouseUp);
    } else {
      holdTimer = window.setTimeout(() => lift(originX, originY), HOLD_MS);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchEnd);
    }
  }

  onUnmounted(() => {
    release(false);
    window.removeEventListener('click', onClickCapture, true);
  });

  return { dragId, overZone, press };
}
