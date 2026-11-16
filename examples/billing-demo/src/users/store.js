// Stores user profiles. Logs only user ids, never emails or names.
const users = new Map();
export const log = [];

export function saveUser({ id, email, name }) {
  users.set(id, { id, email, name });
  log.push(`saved user ${id}`);
  return users.get(id);
}

export function getUser(id) {
  return users.get(id) ?? null;
}
