// The app's current db, for Undo. An Undo runs seconds after its action, so it must restore onto
// the db as it is NOW, not the copy its component rendered with (that would drop anything saved
// since). The app root registers the getter; it always returns the last db persisted.
let getter = () => null;
export const registerLatestDB = fn => { getter = fn; };
export const latestDB = () => getter();
