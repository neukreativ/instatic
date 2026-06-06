/**
 * Shared media-attribute builders for base module render() functions.
 *
 * The image module and the video module's YouTube poster both emit a
 * responsive `srcset` from the same variant-ladder shape (`RenderResolvedMedia`),
 * and both pick a single poster/preview URL from that ladder. The logic is
 * byte-identical, so it lives here once instead of being copied per module.
 *
 * Every URL produced here is run through the canonical `safeUrl` (HTML-escape
 * + scheme sanitisation) so the result is safe to drop straight into an HTML
 * attribute.
 */
import type { RenderResolvedMedia } from '@core/publisher'
import { safeUrl } from '@modules/base/utils/escape'

/**
 * Build a `srcset` attribute from a variant ladder, plus the original as the
 * largest entry so high-DPI displays can pick the full-size file. Returns
 * `null` when the asset has no variants.
 */
export function buildMediaSrcset(media: RenderResolvedMedia): string | null {
  if (!media.variants.length) return null
  const entries = media.variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((v) => `${safeUrl(v.path)} ${v.width}w`)
  if (media.width) entries.push(`${safeUrl(media.publicPath)} ${media.width}w`)
  return entries.join(', ')
}

/**
 * Pick the smallest variant ≥ the asset's intrinsic width (or the caller's
 * target hint). Returns `null` when no usable URL is available.
 *
 * `safeUrl` is applied so the result is HTML-attribute-safe.
 */
export function pickMediaVariantUrl(
  media: RenderResolvedMedia | null,
  targetWidth: number | null,
): string | null {
  if (!media) return null
  if (!media.variants.length) {
    return media.publicPath ? safeUrl(media.publicPath) : null
  }
  const target = targetWidth ?? media.width ?? 1280
  const ladder = media.variants.slice().sort((a, b) => a.width - b.width)
  const pick = ladder.find((v) => v.width >= target) ?? ladder[ladder.length - 1]
  return safeUrl(pick.path)
}
