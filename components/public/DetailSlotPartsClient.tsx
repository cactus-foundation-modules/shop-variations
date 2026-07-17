'use client'

// The client islands behind the `shop.product-detail-parts` slot, so a shop whose
// product has options is buyable straight out of the box - no layout editing, no
// blocks to drag in.
//
// These differ from VariantParts.tsx (the granular blocks a layout author drops
// in by hand, which bring their own styling). Here shop hands us its own class
// names and its server-loaded product data, and we render into them: the shopper
// sees the layout's gallery, price and buy row, quietly made variant-aware. All
// selection state comes from the same store the granular parts use, so the two
// stay in step if both end up on one page.
//
// `initial` is the payload our server half (DetailSlotParts.tsx) resolved while
// the page was rendering. It seeds the shared store on the first render, so the
// options and the chosen combination's price are in the page's HTML rather than
// a fetch behind it. Its absence is survivable, not fatal - the store falls back
// to fetching, which is what these islands used to do unconditionally.
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useVariationSelection } from '@/modules/shop-variations/lib/use-variation-selection'
import type {
  ShopDetailGallerySlotProps,
  ShopDetailPriceSlotProps,
  ShopDetailPurchaseSlotProps,
} from '@/modules/shop/lib/detail-slot'
import type { VariationBootstrap } from '@/modules/shop-variations/lib/types'
import { AddonControl, OptionControl, ResetOptionsLink } from '@/modules/shop-variations/components/public/VariantParts'

type Seeded<P> = P & { initial: VariationBootstrap | null }

const money = (n: number, symbol: string) => `${symbol}${n.toFixed(2)}`

// How far the magnifier goes in. Kept level with shop's own gallery on purpose:
// a product with options must magnify by exactly as much as one without, or the
// shop-wide setting means two different things depending on the product.
const ZOOM_SCALE = 2.5

function pct(offset: number, size: number): string {
  return `${Math.min(100, Math.max(0, (offset / size) * 100))}%`
}

// ---- Gallery -------------------------------------------------------------
// Shop's images render immediately from its server data; once a chosen variant
// carries its own image we lead with that.
//
// The `zoom` prop is shop's shop-wide "magnify the image under the pointer"
// setting, and this gallery has to honour it itself: shop's Gallery part hands
// the whole job over for a claimed product, so a shopper on a product with
// options would otherwise find the setting quietly does nothing.
//
// The behaviour is shop's, reimplemented rather than imported. Shop's version
// lives inside its ProductGallery component, which we can't reuse (it has no
// notion of a variant image), and the two modifier classes behind it -
// `zoomable` and `zoomed` - are shop's own CSS, which the classNames contract
// deliberately doesn't hand over. Those classes carry two declarations between
// them (the cursor, and touch-action while magnified), so they go on inline
// here instead and the fix stays inside this module.
export function VariantSlotGalleryClient({ slug, productName, images, zoom, classNames, initial, extras = [] }: Seeded<ShopDetailGallerySlotProps>) {
  const sel = useVariationSelection(slug, initial)
  const [override, setOverride] = useState<string | null>(null)
  const [hovering, setHovering] = useState(false)
  const [tapped, setTapped] = useState(false)
  const [origin, setOrigin] = useState('50% 50%')
  // Which contributed item (see shop's lib/gallery-media.ts) is on the stage, as
  // { provider id, item key }, or null while an image is showing. Replacing
  // shop's gallery means we inherit its job of rendering these: ignore them and
  // installing a module that contributes gallery media would quietly do nothing
  // on exactly the products we claimed.
  const [picked, setPicked] = useState<{ id: string; key: string } | null>(null)
  const variantImage = sel.variant?.imageUrl ?? null
  // The product actually being bought: the chosen combination's child, or null
  // while nothing is chosen. This is the bit shop cannot know and we can, so a
  // contributed item can narrow itself to the shopper's current choice.
  const activeProductId = sel.variant?.childProductId ?? null

  // A new variant image resets the shopper's manual thumbnail pick, and drops a
  // held tap-zoom with it: the magnified point was chosen on the old picture and
  // means nothing on the new one.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the override in response to a variant change is the intended reset, not derived render state
  useEffect(() => { setOverride(null); setTapped(false) }, [variantImage])

  const thumbs = [...(variantImage ? [{ url: variantImage, alt: productName }] : []), ...images]
    .filter((t, i, arr) => arr.findIndex((x) => x.url === t.url) === i)
  const main = override ?? variantImage ?? images[0]?.url ?? null
  const activeExtra = picked ? extras.find((e) => e.id === picked.id) ?? null : null

  // Magnifying is shop's behaviour for shop's image. A contributed stage owns its
  // whole box (a 3D viewer does its own zooming), so the pointer must reach it
  // untouched rather than through a transform of ours.
  const zoomable = Boolean(zoom) && main !== null && !activeExtra
  const magnified = zoomable && (hovering || tapped)

  function track(e: ReactPointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    setOrigin(`${pct(e.clientX - box.left, box.width)} ${pct(e.clientY - box.top, box.height)}`)
  }

  // Mouse: the magnifier follows the pointer while it's over the stage. Touch: a
  // tap magnifies at the tapped point and a drag then moves the magnified area
  // around, a second tap zooms back out. Touch deliberately isn't wired to
  // pointerenter/leave - a passing finger would magnify and drop the image on
  // every scroll past it.
  const zoomHandlers = zoomable
    ? {
        onPointerEnter: (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.pointerType === 'touch') return
          track(e)
          setHovering(true)
        },
        onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.pointerType === 'touch' && !tapped) return
          track(e)
        },
        onPointerLeave: (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.pointerType === 'touch') return
          setHovering(false)
        },
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
          if (e.pointerType !== 'touch') return
          track(e)
          setTapped((t) => !t)
        },
      }
    : {}

  // No aspectRatio here: the stage is square for every product now, and that
  // comes from shop's own `.spd-stage` class, which arrives via classNames. One
  // ratio, defined once, rather than two modules agreeing to keep saying 1/1.
  const stageStyle: CSSProperties = {
    ...(zoomable ? { cursor: magnified ? 'zoom-out' : 'zoom-in' } : {}),
    // touch-action only while magnified, so a finger passing over a plain image
    // still scrolls the page.
    ...(magnified ? { touchAction: 'none' } : {}),
  }

  return (
    <div className={classNames.col}>
      <div className={classNames.stage} style={stageStyle} {...zoomHandlers}>
        {activeExtra && picked ? (
          <activeExtra.Stage payload={activeExtra.payload} itemKey={picked.key} activeProductId={activeProductId} />
        ) : main ? (
          // eslint-disable-next-line @next/next/no-img-element -- mirrors shop's own gallery, which serves already-sized media URLs
          <img
            className={classNames.image}
            src={main}
            alt={productName}
            draggable={false}
            // Origin stays put while zoomed out, so releasing settles back into
            // the spot the shopper was looking at rather than snapping to centre.
            style={zoomable ? { transformOrigin: origin, transform: magnified ? `scale(${ZOOM_SCALE})` : undefined } : undefined}
          />
        ) : null}
      </div>
      {/* One image plus one contributed item is still two things to pick between. */}
      {thumbs.length + extras.length > 1 && (
        <div className={classNames.thumbs}>
          {thumbs.map((t) => (
            <button
              key={t.url} type="button" onClick={() => { setOverride(t.url); setTapped(false); setPicked(null) }}
              className={main === t.url && !picked ? classNames.thumbOn : classNames.thumb}
              aria-label={`Show ${t.alt}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
              <img src={t.url} alt={t.alt} />
            </button>
          ))}
          {extras.map((extra) => (
            <extra.Thumbs
              key={extra.id}
              payload={extra.payload}
              activeProductId={activeProductId}
              activeKey={picked?.id === extra.id ? picked.key : null}
              onPick={(key) => {
                setPicked(key === null ? null : { id: extra.id, key })
                setTapped(false)
              }}
              thumbClass={classNames.thumb}
              thumbOnClass={classNames.thumbOn}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Price ---------------------------------------------------------------
export function VariantSlotPriceClient({ slug, basePrice, compareAtPrice, savePct, currencySymbol, classNames, initial }: Seeded<ShopDetailPriceSlotProps>) {
  const sel = useVariationSelection(slug, initial)
  const base = Number(basePrice)
  // Shop's own price until the selection resolves, so the figure never blanks.
  const live = sel.loaded && sel.payload ? sel.price : base
  // "Was"/"Save" are the parent's, measured against the parent's price. The
  // moment a choice moves the price off that, they'd be a saving against a
  // number nobody is being charged, so they go.
  const atBase = Math.abs(live - base) < 0.005
  const symbol = sel.loaded && sel.payload ? sel.currencySymbol : currencySymbol

  return (
    <div className={classNames.block}>
      <span className={classNames.now}>{money(live, symbol)}</span>
      {atBase && compareAtPrice && <span className={classNames.was}>{money(Number(compareAtPrice), symbol)}</span>}
      {atBase && savePct != null && savePct > 0 && <span className={classNames.save}>Save {savePct}%</span>}
      {/* The way back out of a chosen combination belongs with the price it moved,
          not buried under the last option. Shop's price block is a wrapping flex
          row, so on a narrow screen this drops to its own line rather than
          squeezing the figure. */}
      <ResetOptionsLink sel={sel} />
    </div>
  )
}

// ---- Purchase area -------------------------------------------------------
// Shop's buy row, plus the option controls and personalisation fields above it.
// This owns availability for a claimed product: stock lives on the chosen
// combination, not on the parent row shop can see.
export function VariantSlotPurchaseClient({ slug, showStepper, label, classNames, layoutBlockTypes, initial }: Seeded<ShopDetailPurchaseSlotProps>) {
  const sel = useVariationSelection(slug, initial)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  // Options and personalisation ride along in this slot because shop has no part
  // of its own for them. When the author has already placed our granular block
  // for either, that block owns it and we must not draw it a second time - the
  // shopper would get two option pickers wired to the same selection.
  const optionsPlaced = layoutBlockTypes.includes('ShopVariantOptions')
  const addonsPlaced = layoutBlockTypes.includes('ShopVariantPersonalisation')

  // With a seeded payload this branch is skipped outright - the real buy row is
  // in the first HTML. It still stands for the unseeded fallback: render the row
  // with the button held disabled rather than returning null, which would blink
  // the page's main call to action out of existence on first paint, something
  // shop's own server-rendered button never did.
  if (!sel.loaded || !sel.payload) {
    return (
      <div className={classNames.row}>
        <button type="button" className={classNames.add} disabled>{label}</button>
      </div>
    )
  }

  const reason = !sel.allOptionsChosen ? 'Choose your options'
    : sel.hasOptions && !sel.inStock ? 'Out of stock'
    : !sel.addonPricing.valid ? (sel.addonPricing.reason ?? 'Complete the required fields')
    : null

  return (
    <div>
      {!optionsPlaced && sel.payload.options.length > 0 && (
        <div style={{ display: 'grid', gap: '1rem', marginTop: '18px' }}>
          {sel.payload.options.map((option) => (
            <OptionControl key={option.id} option={option} sel={sel} />
          ))}
        </div>
      )}
      {!addonsPlaced && sel.payload.addons.length > 0 && (
        <div style={{ display: 'grid', gap: '0.875rem', marginTop: '18px' }}>
          {sel.payload.addons.map((addon) => (
            <AddonControl
              key={addon.id} addon={addon} value={sel.addonValues[addon.id]}
              onChange={(v) => sel.setAddon(addon.id, v)} currency={sel.currencySymbol} slug={slug}
            />
          ))}
        </div>
      )}

      <div className={classNames.row}>
        {showStepper && (
          <div className={classNames.stepper}>
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">−</button>
            <input
              type="text" inputMode="numeric" value={qty} aria-label="Quantity"
              onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
            />
            <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">+</button>
          </div>
        )}
        <button
          type="button" className={classNames.add} disabled={!sel.canAdd}
          onClick={() => { if (sel.add(qty)) { setAdded(true); window.setTimeout(() => setAdded(false), 2000) } }}
        >
          {added ? 'Added ✓' : label}
        </button>
      </div>
      {reason && <p className={classNames.outOfStock}>{reason}</p>}
    </div>
  )
}
