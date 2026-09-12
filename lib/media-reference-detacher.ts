import { prisma } from '@/lib/db/prisma'
import type { MediaReferenceDetach } from '@/lib/media/reference-detachers'

// Provider for the core.media-reference-detachers extension point.
//
// The companion to media-reference-rewriter.ts: that one follows a swatch picture
// to its new url when the blob moves, this one lets go of it when the picture is
// deleted outright. An IMAGE-type option value whose swatch column still names a
// deleted blob draws a broken square in the middle of a product's colour picker -
// the one control a customer has to use before they can buy anything.
//
// Nulled rather than removed: the option VALUE is still a real choice a customer
// can pick (a fabric called Rivet Teal does not stop existing because its
// photograph was binned), and an image-type value with no swatch falls back to
// its label. Deleting the value would take the variants priced against it with
// it, which is a catalogue edit, not a media tidy-up.
//
// svr_uploads is deliberately left alone: that is the artwork a customer supplied
// with an order, and it is kept because somebody has to be able to see what was
// actually sent to print.
export async function shopVariationsMediaReferenceDetacher(media: MediaReferenceDetach): Promise<void> {
  const { url } = media
  if (!url) return

  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "svr_option_values" SET "swatch" = NULL WHERE "swatch" = ${url}`,
    // Each rendition is a library item in its own right with its own url, so a
    // delete of one of THOSE has to land here the same way.
    prisma.$executeRaw`UPDATE "svr_option_values" SET "swatch_small" = NULL WHERE "swatch_small" = ${url}`,
    prisma.$executeRaw`UPDATE "svr_option_values" SET "swatch_tiny" = NULL WHERE "swatch_tiny" = ${url}`,
  ])
}
