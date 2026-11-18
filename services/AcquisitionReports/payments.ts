import type { PipelineStage } from 'mongoose';
import Inscription from '../../models/Inscription.js';
import { stage } from './attribution.js';

/**
 * Mongo expressions over an inscription (`inv` is a variable such as '$$i') that decide what
 * counts as a purchase, a partial payment and collected revenue inside a time window. Revenue is
 * always money actually collected: payment history entries, or the legacy deposit/paid fallback
 * for inscriptions that predate the history.
 */
type Expression = unknown;

const inWindow = (date: Expression, start: Expression, end: Expression): Expression => ({
  $and: [{ $gte: [date, start] }, { $lt: [date, end] }],
});

/** When the inscription was fully paid: explicit payment date, else its last payment. */
const completionDate = (inv: string): Expression => ({
  $ifNull: [`${inv}.paymentDate`, { $ifNull: [{ $max: `${inv}.paymentHistory.date` }, { $ifNull: [`${inv}.depositDate`, `${inv}.fechaInscripcion`] }] }],
});

export const collectedIn = (inv: string, start: Expression, end: Expression): Expression => {
  const legacyAmount = {
    $cond: [
      { $gt: [{ $ifNull: [`${inv}.depositAmount`, 0] }, 0] },
      `${inv}.depositAmount`,
      { $cond: [{ $eq: [`${inv}.paymentStatus`, 'paid'] }, { $ifNull: [`${inv}.coursePrice`, 0] }, 0] },
    ],
  };
  const legacyDate = { $ifNull: [`${inv}.depositDate`, { $ifNull: [`${inv}.paymentDate`, `${inv}.fechaInscripcion`] }] };

  return {
    $let: {
      vars: { history: { $ifNull: [`${inv}.paymentHistory`, []] } },
      in: {
        $cond: [
          { $gt: [{ $size: '$$history' }, 0] },
          {
            $sum: {
              $map: {
                input: { $filter: { input: '$$history', as: 'entry', cond: inWindow('$$entry.date', start, end) } },
                as: 'paid',
                in: '$$paid.amount',
              },
            },
          },
          { $cond: [inWindow(legacyDate, start, end), legacyAmount, 0] },
        ],
      },
    },
  };
};

export const completedIn = (inv: string, start: Expression, end: Expression): Expression => ({
  $and: [{ $eq: [`${inv}.paymentStatus`, 'paid'] }, inWindow(completionDate(inv), start, end)],
});

/**
 * Collected money inside the window without completing the purchase inside it. Defined by the
 * payments, not by today's status, so it does not change when the inscription is settled later.
 */
export const partialIn = (inv: string, start: Expression, end: Expression): Expression => ({
  $and: [{ $gt: [collectedIn(inv, start, end), 0] }, { $not: [completedIn(inv, start, end)] }],
});

export const createdIn = (start: Expression, end: Expression): Expression => inWindow('$fechaInscripcion', start, end);

/** Only the fields the money expressions read: names, emails and phones never enter a pipeline. */
const MONEY_FIELDS = { paymentStatus: 1, paymentHistory: 1, paymentDate: 1, depositAmount: 1, depositDate: 1, coursePrice: 1, fechaInscripcion: 1 };

/** `$lookup` of inscriptions by `_id` that keeps only what is needed to price them. */
export const inscriptionsLookup = (localField: string, as: string): PipelineStage =>
  stage({ $lookup: { from: Inscription.collection.name, localField, foreignField: '_id', pipeline: [{ $project: MONEY_FIELDS }], as } });
