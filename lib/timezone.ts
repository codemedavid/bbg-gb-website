// The one timezone this business runs on.
//
// Kept apart from the schedule engine and from lib/format.ts because both need
// it and neither owns it: the engine decides when a page opens, the formatters
// decide how a timestamp reads, and both must mean the same zone. A second
// literal 'Asia/Manila' somewhere is how the two quietly drift apart.
export const MANILA_TZ = 'Asia/Manila';

/** How the timezone is named to admins, who need to know what the times mean. */
export const MANILA_TZ_LABEL = 'Philippine Standard Time (PHT · UTC+08:00)';
export const MANILA_TZ_SHORT = 'PHT';
