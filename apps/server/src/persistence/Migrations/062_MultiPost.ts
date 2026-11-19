import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ensureMultiPostSchema } from "../../multipost/schema";
export default Effect.gen(function* () {
  yield* ensureMultiPostSchema(yield* SqlClient.SqlClient);
});
