import { unlock, main } from "./lib/core.mjs";
main((o) => {
  unlock(o.target);
  console.log(
    JSON.stringify({
      status: "LOCAL_DEAD_LOCK_ARCHIVED",
      next: "Confirm previous workflow terminal record and run state recover before new work",
    }),
  );
});
