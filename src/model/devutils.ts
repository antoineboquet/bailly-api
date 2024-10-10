import { Database } from "../Database.ts";
import type {
  ApiParams,
  ApiResponse,
  DatabaseEntry,
  Entry,
  EntryWithSiblings,
  PartialExcept,
  QueryableFields
} from "../definitions.ts";
import { setUniqueEntries } from "../helpers.ts";
import { Settings } from "../Settings.ts";

interface ApiEntryBatchResponse<K extends keyof QueryableFields>
  extends ApiResponse {
  data: {
    version: string;
    entries: EntryWithSiblings<K>[];
  };
}

type ApuEntryBatchParams<K extends keyof QueryableFields> = Pick<
  ApiParams<K>,
  "fields" | "limit" | "offset"
>;

export async function getEntryBatch<K extends keyof QueryableFields>({
  fields,
  limit,
  offset
}: ApuEntryBatchParams<K>): Promise<ApiEntryBatchResponse<K>> {
  const db = await Database.getConnection();
  const settings = Settings.getSettings();
  const fieldsStr: string = fields.join(", ");

  const sql = `
    SELECT word, ${fieldsStr}
    FROM bailly
  `;

  const entries = <PartialExcept<DatabaseEntry, "word">[]>db.query(sql).all();
  const uniqueEntries = setUniqueEntries(entries);

  limit = limit ?? 0;
  offset = offset ?? 0;

  const scliceEnd: number | undefined =
    offset + limit > offset ? offset + limit : undefined;

  const uniqueEntriesWithSiblings: any[] /*EntryWithSiblings<K>[]*/ =
    uniqueEntries.slice(offset, scliceEnd).map((entry, i) => {
      const cursor = offset + i;
      const newEntry = {
        entry: entry,
        siblings: {
          previous: uniqueEntries[cursor - 1]
            ? structuredClone(uniqueEntries[cursor - 1])
            : ({} as Entry),
          next: uniqueEntries[cursor + 1]
            ? structuredClone(uniqueEntries[cursor + 1])
            : ({} as Entry)
        }
      };

      delete newEntry.siblings.previous.children;
      delete newEntry.siblings.next.children;

      return newEntry;
    });

  return {
    data: {
      version: settings.dbVersion,
      entries: uniqueEntriesWithSiblings
    }
  };
}
