import type { DatabaseEntry, Entry } from "./definitions.ts";

export class Settings {
  private static settings: Settings;

  readonly dbFilePath: string;
  readonly dbVersion: string;
  readonly jwtSecret: string;
  readonly morpheusBinaryFilePath: string;
  readonly morpheusLookupMaxDuration: number;
  readonly morpheusStemlibPath: string;
  readonly port: number;
  readonly queryAllowedFields: string[];
  readonly queryDefaultFields: string[];
  readonly queryMaxRows: number;

  private constructor() {
    const {
      DB_FILE_PATH,
      DB_VERSION,
      JWT_SECRET,
      MORPHEUS_BINARY_FILE_PATH,
      MORPHEUS_LOOKUP_MAX_DURATION,
      MORPHEUS_STEMLIB_PATH,
      PORT,
      QUERY_ALLOWED_FIELDS,
      QUERY_DEFAULT_FIELDS,
      QUERY_MAX_ROWS
    } = process.env;

    // General

    this.port = Number(PORT ?? 3000);

    if (!JWT_SECRET) throw new Error("A JWT secret is missing from `./.env`.");
    this.jwtSecret = JWT_SECRET;

    // Database

    this.dbFilePath = String(DB_FILE_PATH);
    this.dbVersion = String(DB_VERSION);

    // Morpheus

    this.morpheusBinaryFilePath = String(MORPHEUS_BINARY_FILE_PATH);
    this.morpheusLookupMaxDuration = Number(
      MORPHEUS_LOOKUP_MAX_DURATION ?? 100
    );
    this.morpheusStemlibPath = String(MORPHEUS_STEMLIB_PATH);

    // Query params

    this.queryAllowedFields = QUERY_ALLOWED_FIELDS
      ? (Settings.formatFields(QUERY_ALLOWED_FIELDS) as (keyof DatabaseEntry)[])
      : [];
    this.queryDefaultFields =
      QUERY_DEFAULT_FIELDS &&
      this.checkFields(Settings.formatFields(QUERY_DEFAULT_FIELDS))
        ? (Settings.formatFields(
            QUERY_DEFAULT_FIELDS
          ) as (keyof DatabaseEntry)[])
        : this.queryAllowedFields;
    this.queryMaxRows = Number(QUERY_MAX_ROWS ?? -1);
  }

  static getSettings(): Settings {
    if (!Settings.settings) Settings.settings = new Settings();
    return Settings.settings;
  }

  checkFields(fields: string[]): boolean {
    return fields.every((field) => this.queryAllowedFields.includes(field));
  }

  static formatFields(fields: string): string[] {
    return fields.replace(/\s/g, "").split(",");
  }
}
