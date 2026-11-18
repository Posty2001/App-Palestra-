import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { setDbForTests } from '../local/db';

// Ogni test parte da un archivio vuoto e indipendente.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  setDbForTests(null);
});
