import { AppError } from './errors.js';
import { parseCsv, stringifyCsv } from './csv.js';
import { GitHubClient } from './github.js';
import { TABLE_DEFINITIONS, tableDefinition } from './schema.js';

export class CsvStore {
  constructor(env) {
    this.github = new GitHubClient(env);
  }

  async initialized() {
    const head = await this.github.getHeadSha();
    if (!head) return false;
    const users = await this.github.readFile(TABLE_DEFINITIONS.users.path, head);
    return Boolean(users && users.trim());
  }

  async ensureBranch() {
    return this.github.ensureDataBranch();
  }

  async readTables(names, { allowMissing = false } = {}) {
    const head = await this.github.getHeadSha();
    if (!head) {
      if (allowMissing) return { head: null, tables: Object.fromEntries(names.map((name) => [name, []])) };
      throw new AppError(503, 'SETUP_REQUIRED', 'La aplicación todavía no ha sido inicializada.');
    }

    const entries = await Promise.all(names.map(async (name) => {
      const definition = tableDefinition(name);
      const content = await this.github.readFile(definition.path, head);
      if (content === null && !allowMissing) {
        throw new AppError(503, 'SETUP_REQUIRED', `Falta el archivo de datos ${definition.path}.`);
      }
      return [name, content === null ? [] : parseCsv(content)];
    }));

    return { head, tables: Object.fromEntries(entries) };
  }

  async writeInitialTables(tables, message = 'Initialize application data') {
    await this.ensureBranch();
    const head = await this.github.getHeadSha();
    if (!head) throw new AppError(500, 'DATA_BRANCH_MISSING', 'No fue posible crear la rama de datos.');

    const existing = await this.github.readFile(TABLE_DEFINITIONS.users.path, head);
    if (existing && existing.trim()) {
      throw new AppError(409, 'ALREADY_INITIALIZED', 'La aplicación ya fue inicializada.');
    }

    const files = {};
    for (const [name, rows] of Object.entries(tables)) {
      const definition = tableDefinition(name);
      files[definition.path] = stringifyCsv(rows, definition.columns);
    }

    return this.github.createCommitFromFiles({ files, message, expectedHead: head });
  }

  async mutateTables(names, mutator, message, { retries = 3 } = {}) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const snapshot = await this.readTables(names);
      const mutableTables = Object.fromEntries(
        Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
      );

      const result = await mutator(mutableTables, { attempt, head: snapshot.head });
      const changedNames = result?.changedNames || names;
      const files = {};

      for (const name of changedNames) {
        const definition = tableDefinition(name);
        files[definition.path] = stringifyCsv(mutableTables[name], definition.columns);
      }

      try {
        const commitSha = await this.github.createCommitFromFiles({
          files,
          message,
          expectedHead: snapshot.head,
        });
        return { ...result, commitSha };
      } catch (error) {
        if (error.code !== 'WRITE_CONFLICT' || attempt === retries) throw error;
        lastError = error;
      }
    }

    throw lastError || new AppError(409, 'WRITE_CONFLICT', 'No fue posible guardar porque los datos cambiaron simultáneamente.');
  }
}
