// Sign-in sessions. A session lasts 30 days; requireUser rejects a missing or expired one.
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_DAYS = 30;

export function signIn(userId, now = Date.now()) {
  return { userId, expiresAt: now + SESSION_DAYS * DAY_MS };
}

export function requireUser(session, now = Date.now()) {
  if (!session || typeof session.userId !== "string" || !session.userId)
    throw new Error("not signed in");
  if (!(session.expiresAt > now)) throw new Error("session expired");
  return session.userId;
}
