import { $ } from "bun";
import { KeyType, toGreek } from "greek-conversion";
import type {
  DatabaseEntry,
  Entry,
  MorpheusData,
  MorpheusDataItem,
  NonEmptyArray,
  Optional,
  PartialExcept,
  QueryableFields
} from "./definitions.ts";
import { Settings } from "./Settings.ts";

export function setNumericParam(param?: string): number | undefined {
  const value: number = Number(param);

  if (Number.isNaN(value) || value < 1 || !Number.isInteger(value)) {
    return undefined;
  }

  return Number(param);
}

export function setNumericRangeParam(param?: string): [number, number?] | null {
  const arr: number[] = (param ?? "")
    .split(",")
    .map((item) => Number.parseInt(item, 10))
    .sort((a, b) => a - b);

  if (!arr.length || arr.some((item) => Number.isNaN(item))) return null;
  return arr.length > 1 ? [arr[0], arr[1]] : [arr[0]];
}

export function setSelectedFields(
  fields?: string
): NonEmptyArray<keyof QueryableFields> {
  const settings = Settings.getSettings();
  const formattedFields = Settings.formatFields(fields ?? "");

  const selectedFields = settings.checkFields(formattedFields)
    ? formattedFields
    : settings.queryDefaultFields;

  return selectedFields as NonEmptyArray<keyof QueryableFields>;
}

export function setUniqueEntries(
  inputEntries: PartialExcept<DatabaseEntry, "word">[],
  params?: {
    caseSensitive?: boolean;
  }
): (PartialExcept<Entry, "word" | "children"> &
  Optional<DatabaseEntry, "searchable" | "searchableCaseInsensitive">)[] {
  const uniqueEntries: PartialExcept<Entry, "word">[] = [];
  for (const [word, entries] of Object.entries(
    Object.groupBy(inputEntries, ({ word }) => word)
  )) {
    if (!entries) continue;

    if (entries.length > 1) {
      // Create a common entry and place the actual entries as children.
      let entry: PartialExcept<Entry<"word">, "word" | "children"> &
        Optional<DatabaseEntry, "searchable" | "searchableCaseInsensitive"> = {
        ...entries[0]
      };

      // @ts-ignore
      Object.keys(entries[0]).forEach((prop) => (entry[prop] = ""));

      entry.word = word;
      entry.uri = entries[0].uri?.replace(/#\d$/, "");
      entry.children = entries; // children may be truncated due to `limit` param

      if (params && Object.keys(params).length) {
        if ("caseSensitive" in params) {
          if (params.caseSensitive) {
            entry.searchable = entries[0].searchable ?? "";
          } else {
            entry.searchableCaseInsensitive =
              entries[0].searchableCaseInsensitive ?? "";
          }
        }
      }

      uniqueEntries.push(entry);
      continue;
    }

    uniqueEntries.push(entries[0]);
  }

  return uniqueEntries;
}

async function runTimeLimitedPromise<T>(
  promise: Promise<T>,
  ms: number = 1000
): Promise<T> {
  const timedPromise = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error("timed out")), ms)
  );

  return await Promise.race([promise, timedPromise]);
}

function formatMorpheusResponse(item: string): MorpheusDataItem {
  const formattedData: MorpheusDataItem = item
    .split(":")
    .splice(1)
    .reduce(
      (acc, curr) => {
        const [key, value] = curr.split(" ", 2);
        // @ts-ignore
        acc[key] = value.trim();
        return acc;
      },
      { workw: "", lem: "", prvb: "", aug1: "", stem: "", suff: "", end: "" }
    );

  formattedData.workw = toGreek(formattedData.workw, KeyType.BETA_CODE);
  formattedData.lem = toGreek(formattedData.lem, KeyType.BETA_CODE);
  formattedData.end = toGreek(formattedData.end, KeyType.BETA_CODE);

  return formattedData;
}

export async function lookupMorpheus(
  betaCodeStr: string
): Promise<MorpheusData> {
  const settings = Settings.getSettings();
  const bin = settings.morpheusBinaryFilePath;
  const stem = settings.morpheusStemlibPath;

  if (!bin || !stem) {
    console.error(
      "A binary and a stemlib path must be provided",
      "in order to call Morpheus."
    );
    return {};
  }

  let data: string;
  try {
    // -S: case insensitive; -n: ignore accents; -d: dictionary format.
    data = await runTimeLimitedPromise(
      $`echo "${betaCodeStr}" | MORPHLIB=${stem} ${bin} -S -n -d`.text(),
      settings.morpheusLookupMaxDuration
    );
  } catch (e) {
    console.error(`Morpheus call failed with error <${e}>`);
    return {};
  }

  const formattedData = data
    .split(/:raw.*\s+/)
    .splice(1)
    .map((item) => formatMorpheusResponse(item));

  return <MorpheusData>(
    Object.groupBy(formattedData, ({ lem }) => lem.replace(/\d+$/, ""))
  );
}
