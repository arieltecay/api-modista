/** Funnel order. `page_view` is the entry, so it is not a step; the top of the funnel is the visit itself. */
export const FUNNEL_STEPS = [
  'course_detail_view',
  'pricing_visible',
  'cta_click',
  'form_view',
  'form_start',
  'form_submit',
  'lead',
  'initiate_checkout',
  'redirect_to_payment',
  'purchase',
] as const;

/** Furthest funnel step among event names, or 'visit' when none of them is a step. */
export const furthestStep = (eventNames: readonly string[]): string => {
  const index = Math.max(-1, ...eventNames.map((name) => (FUNNEL_STEPS as readonly string[]).indexOf(name)));
  return index === -1 ? 'visit' : FUNNEL_STEPS[index];
};
