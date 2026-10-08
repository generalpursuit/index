import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = {
  ...defineRelations(schema),
  ...schema.authRelations,
  ...schema.appRelations,
  user: {
    ...schema.authRelations.user,
    relations: {
      ...schema.authRelations.user.relations,
      ...schema.appRelations.user.relations,
    },
  },
};
