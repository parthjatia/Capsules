// Seeds local data. Deliberately not covered by any capsule, so `capsules status` shows an orphan.
import { saveUser } from "../src/users/store.js";

saveUser({ id: "u1", email: "a@example.com", name: "Ada" });
