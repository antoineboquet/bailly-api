import type { BunFile } from "bun";
import { Database as Sqlite } from "bun:sqlite";

export class Database {
  private static connection: Sqlite;

  private constructor() {}

  static async getConnection(): Promise<Sqlite> {
    if (!Database.connection) {
      const dbFilePath: string = process.env.DB_FILE_PATH ?? "";
      const gzippedDbFilePath: string = `${dbFilePath}.gz`;

      if (!dbFilePath) {
        throw new Error(
          "The 'DB_FILE_PATH' environment variable hasn't been set."
        );
      }

      const dBFile: BunFile = Bun.file(dbFilePath);
      const gzippedDbFile: BunFile = Bun.file(gzippedDbFilePath);

      const dbFileExists = await dBFile.exists();
      const gzippedDbFileExists = await gzippedDbFile.exists();

      if (!dbFileExists && gzippedDbFileExists) {
        console.log("⏳ Unzipping database file...");
        const buffer = await gzippedDbFile.arrayBuffer();
        await Bun.write(dBFile, Bun.gunzipSync(buffer));
        console.log("✅ Database file unzipped.");
      }

      if (!dbFileExists && !gzippedDbFileExists) {
        throw new Error(
          `Database file not found. Check that the 'DB_FILE_PATH' value ` +
            `corresponds to an actual file (current value is '${dbFilePath}').`
        );
      }

      Database.connection = new Sqlite(dbFilePath, {
        readonly: true,
        strict: true
      });

      Database.connection.exec("PRAGMA mmap_size = 30000000000;");
    }

    return Database.connection;
  }
}
