// Whether a move would change the arrangement (ARCHITECTURE-PLUS P3.1.4: "A choice that would
// change nothing is still accepted and does nothing"). Owner: N1.

import { Model, type Action } from 'flexlayout-react';
import { indexModel } from './live';
import { sameShape } from './model';

/** True when `action` leaves the same groups with the same panels in the same order and places. */
export function moveTargetsChangeNothing(model: Model, action: Action): boolean {
  const before = indexModel(model).tree;
  const copy = Model.fromJson(model.toJson());
  copy.doAction(action);
  return sameShape(before, indexModel(copy).tree);
}
